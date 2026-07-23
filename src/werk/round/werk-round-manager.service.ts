import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RngService } from '../../rng/rng.service';
import { WalletService } from '../../wallet/wallet.service';
import { GamesService } from '../../games/games.service';
import { GameEventsGateway } from '../../events/game-events.gateway';
import { WerkRound } from '../entities/werk-round.entity';
import { WerkParticipant } from '../entities/werk-participant.entity';
import { WerkConfig } from '../entities/werk-config.entity';
import { User } from '../../users/entities/user.entity';
import { WerkService } from '../werk.service';
import { buildBotRoster, type WerkBotDescriptor } from '../werk-bots';
import {
  buildLayout, BotSim, makeRng, moveWithSlide, toCell,
  CELL, HUMAN_SPEED, COLLECT_RADIUS, PLAYER_RADIUS, SIM_DT,
  type Layout, type BotConfig, type SharedCoinPool, type WinMode,
} from '../sim';
import { applyRoundWinControl, rankParticipants, type RoundBot, type RoundHuman } from './win-control';

// Human movement constants — mirror the client engine so server-authoritative
// motion matches what a player predicts locally.
const SPRINT_MULT = 1.6;
const STAMINA_MAX = 100;
const STAMINA_DRAIN = 30;
const STAMINA_REGEN = 20;
const SPEED_BOOST_MULT = 1.5;
const SPEED_BOOST_SEC = 5;
const MAGNET_SEC = 8;
const MAGNET_RADIUS = CELL * 1.6;
const SHIELD_SEC = 10;

/** Distinguish human arbitration ids from bot ids (bots are 1..N). */
const HUMAN_ID_BASE = 1_000_000;

export interface WerkInput {
  moveX?: number;
  moveY?: number;
  sprint?: boolean;
  usePower?: boolean;
}

interface HumanRuntime {
  participantId: string;
  userId: string;
  arbId: number;
  name: string;
  color: string;
  seatIndex: number;
  x: number;
  y: number;
  input: WerkInput;
  usePowerLatch: boolean;
  coinValue: number;
  collected: Set<number>;
  stamina: number;
  boost: number;
  magnet: number;
  shield: number;
  pendingSpeed: boolean;
  pendingMagnet: boolean;
  pendingShield: boolean;
  connected: boolean;
}

interface LiveRound {
  round: WerkRound;
  layout: Layout;
  botSim: BotSim;
  coinOwner: Map<number, number>;
  shared: SharedCoinPool;
  takenPowerups: Set<number>;
  humans: Map<string, HumanRuntime>; // keyed by userId
  elapsed: number;
  lastTickAt: number;
  settling: boolean;
}

const HUMAN_COLORS = ['#00D4FF', '#7C5CFF', '#34D399', '#FBBF24', '#FF5C5C', '#F472B6', '#22D3EE', '#A3E635', '#F59E0B', '#E879F9'];

/**
 * Authoritative in-memory engine for the single active Werk round. The leader
 * instance (elected in WerkScheduler via a Redis lock) drives `fastTick` (~15Hz)
 * and `lifecycle` (~1Hz). The server owns the clock, positions, shared coin pool,
 * and final standings; clients only send input and render broadcast snapshots.
 */
@Injectable()
export class WerkRoundManager implements OnApplicationBootstrap {
  private readonly logger = new Logger(WerkRoundManager.name);
  private live: LiveRound | null = null;

  constructor(
    @InjectRepository(WerkRound) private readonly roundRepo: Repository<WerkRound>,
    @InjectRepository(WerkParticipant) private readonly participantRepo: Repository<WerkParticipant>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly rngService: RngService,
    private readonly walletService: WalletService,
    private readonly gamesService: GamesService,
    private readonly werkService: WerkService,
    private readonly gateway: GameEventsGateway,
  ) {}

  onApplicationBootstrap(): void {
    // Let the gateway forward client input to us without a circular module import.
    this.gateway.registerWerkInputHandler((userId, input) => this.handleInput(userId, input));
  }

  // ── Lifecycle (driven ~1Hz by the leader) ────────────────────────────────────

  /** Reconcile the active round, start/settle/rotate as due. Leader-only. */
  async lifecycle(): Promise<void> {
    const cfg = await this.werkService.getConfig();
    const playable = await this.gamesService.isPlayable('werk').catch(() => false);

    if (!this.live) {
      await this.loadOrCreateActive(cfg, playable);
      return;
    }

    const r = this.live.round;
    const now = Date.now();
    if (r.status === 'lobby') {
      if (r.scheduledStartAt && now >= r.scheduledStartAt.getTime()) {
        if (this.live.humans.size > 0) await this.startRound(cfg);
        else await this.cancelRound('no players');
      } else if (this.live.humans.size === 0 && this.gateway.werkPresenceCount() === 0) {
        // No one has joined AND no one is even watching the Werk screen — tear the
        // idle lobby down so nothing exists while there are no users.
        await this.cancelRound('no users present');
      }
    } else if (r.status === 'running') {
      const timeLeft = r.durationSec - this.live.elapsed;
      if (timeLeft <= 0) await this.settleRound(cfg);
    } else if (r.status === 'completed') {
      const endedAt = r.endedAt?.getTime() ?? now;
      if (now - endedAt >= (cfg.resultDisplaySec ?? 8) * 1000) {
        await this.finalizeAndRotate(cfg, playable);
      }
    }
  }

  /** Advance the running round and broadcast a snapshot. Leader-only, ~15Hz. */
  fastTick(): void {
    const live = this.live;
    if (!live || live.round.status !== 'running' || live.settling) return;
    const now = Date.now();
    let dt = (now - live.lastTickAt) / 1000;
    live.lastTickAt = now;
    if (dt <= 0) return;
    if (dt > 0.25) dt = 0.25; // clamp after a stall so we don't fast-forward wildly

    let acc = dt;
    const total = live.round.durationSec;
    while (acc >= SIM_DT && live.elapsed < total) {
      acc -= SIM_DT;
      this.stepOnce(live, SIM_DT);
      live.elapsed += SIM_DT;
    }
    this.broadcastSnapshot(live);
  }

  private stepOnce(live: LiveRound, dt: number): void {
    if (live.round.botsEnabled) live.botSim.step(dt);
    for (const h of live.humans.values()) {
      this.stepHuman(live, h, dt);
      this.collectHuman(live, h);
    }
  }

  private stepHuman(live: LiveRound, h: HumanRuntime, dt: number): void {
    h.boost = Math.max(0, h.boost - dt);
    h.magnet = Math.max(0, h.magnet - dt);
    h.shield = Math.max(0, h.shield - dt);

    if (h.usePowerLatch) {
      if (h.boost <= 0 && h.pendingSpeed) { h.boost = SPEED_BOOST_SEC; h.pendingSpeed = false; }
      else if (h.magnet <= 0 && h.pendingMagnet) { h.magnet = MAGNET_SEC; h.pendingMagnet = false; }
      else if (h.shield <= 0 && h.pendingShield) { h.shield = SHIELD_SEC; h.pendingShield = false; }
      h.usePowerLatch = false;
    }

    const ax = h.input.moveX ?? 0, ay = h.input.moveY ?? 0;
    const aMag = Math.hypot(ax, ay);
    if (aMag <= 0.001) {
      h.stamina = Math.min(STAMINA_MAX, h.stamina + STAMINA_REGEN * dt);
      return;
    }
    const mag = Math.min(1, aMag);
    const dirX = ax / aMag, dirY = ay / aMag;
    const wantSprint = !!h.input.sprint && h.stamina > 0;
    if (wantSprint) h.stamina = Math.max(0, h.stamina - STAMINA_DRAIN * dt);
    else h.stamina = Math.min(STAMINA_MAX, h.stamina + STAMINA_REGEN * dt);

    let spd = HUMAN_SPEED * (0.45 + 0.55 * mag);
    if (wantSprint) spd *= SPRINT_MULT;
    if (h.boost > 0) spd *= SPEED_BOOST_MULT;
    const [nx, ny] = moveWithSlide(live.layout, h.x, h.y, dirX * spd * dt, dirY * spd * dt, PLAYER_RADIUS);
    h.x = nx; h.y = ny;
  }

  private collectHuman(live: LiveRound, h: HumanRuntime): void {
    const radius = h.magnet > 0 ? MAGNET_RADIUS : COLLECT_RADIUS;
    for (const c of live.layout.coins) {
      if (live.coinOwner.has(c.index)) continue;
      if (Math.hypot(c.x - h.x, c.y - h.y) < radius) {
        if (live.shared.take(c.index, h.arbId)) {
          h.collected.add(c.index);
          h.coinValue += c.value;
        }
      }
    }
    live.layout.powerups.forEach((pu, i) => {
      if (live.takenPowerups.has(i)) return;
      if (Math.hypot(pu.x - h.x, pu.y - h.y) < COLLECT_RADIUS) {
        live.takenPowerups.add(i);
        if (pu.kind === 'speed') h.pendingSpeed = true;
        else if (pu.kind === 'magnet') h.pendingMagnet = true;
        else h.pendingShield = true;
      }
    });
  }

  // ── Round creation / rotation ────────────────────────────────────────────────

  private async loadOrCreateActive(cfg: WerkConfig, playable: boolean): Promise<void> {
    const active = await this.roundRepo.findOne({ where: { activeGuard: 1 } });
    if (active) {
      // A round exists (e.g. leader restarted) — rehydrate a lobby; a running one
      // that lost its in-memory state is settled immediately to release the slot.
      if (active.status === 'running' || active.status === 'settling') {
        await this.cancelRoundRow(active, 'leader restart');
        return;
      }
      if (active.status === 'lobby') {
        this.live = this.hydrate(active);
        await this.rehydrateParticipants(this.live);
        return;
      }
      // completed still holding the slot — let the result window expire naturally.
      this.live = this.hydrate(active);
      return;
    }
    // Only open a lobby when at least one user is actually on the Werk screen —
    // no round should exist (or start) while there are no users.
    if (playable && cfg.enabled && this.gateway.werkPresenceCount() > 0) await this.ensureLobby(cfg);
  }

  /** Create a fresh idle lobby round (no countdown until the first join). */
  private async ensureLobby(cfg: WerkConfig): Promise<void> {
    const botCount = this.werkService.effectiveBotCount(cfg);
    const pool = await this.werkService.loadBotPool();

    const round = await this.dataSource.transaction(async (m) => {
      const created = m.create(WerkRound, {
        status: 'lobby',
        mode: cfg.winningMode,
        durationSec: cfg.gameDurationSec,
        coinDensityX100: cfg.coinDensityX100,
        finalSprintWarningSec: cfg.finalSprintWarningSec,
        powerupsEnabled: cfg.powerupsEnabled,
        maxPlayers: cfg.totalPlayers,
        seed: 0,
        botsEnabled: botCount > 0,
        activeGuard: 1,
      });
      await m.save(created);
      const draw = await this.rngService.drawSeed({
        gameType: 'werk', gameReference: created.id,
        metadata: { maxPlayers: cfg.totalPlayers, botCount, mode: cfg.winningMode }, manager: m,
      });
      created.seed = draw.numbers[0];
      created.seedAuditLogId = draw.auditLogId ?? null;
      created.botRoster = buildBotRoster(
        created.seed, botCount,
        { botSeedMode: cfg.botSeedMode, botSpeedPct: cfg.botSpeedPct, botSkillPct: cfg.botSkillPct },
        pool,
      );
      await m.save(created);
      return created;
    });

    this.live = this.hydrate(round);
    this.gateway.emitWerkRoundState(this.roundView(round));
    this.logger.log(`Opened Werk lobby round ${round.id}`);
  }

  /** Build the in-memory state for a DB round row. */
  private hydrate(round: WerkRound): LiveRound {
    const roster = (round.botRoster as WerkBotDescriptor[] | null) ?? [];
    const layout = buildLayout(Number(round.seed), {
      totalPlayers: round.maxPlayers,
      coinDensityX100: round.coinDensityX100,
      powerupsEnabled: round.powerupsEnabled,
      botCount: roster.length,
    });
    const coinOwner = new Map<number, number>();
    const shared: SharedCoinPool = {
      has: (i) => coinOwner.has(i),
      take: (i, byId) => { if (coinOwner.has(i)) return false; coinOwner.set(i, byId); return true; },
    };
    const botSim = new BotSim(layout, roster as BotConfig[], {
      mode: round.mode, durationSec: round.durationSec, finalSprintWarningSec: round.finalSprintWarningSec,
    }, shared);
    return { round, layout, botSim, coinOwner, shared, takenPowerups: new Set(), humans: new Map(), elapsed: 0, lastTickAt: Date.now(), settling: false };
  }

  private async rehydrateParticipants(live: LiveRound): Promise<void> {
    const rows = await this.participantRepo.find({ where: { roundId: live.round.id, status: 'joined' } });
    for (const p of rows) this.addHumanRuntime(live, p, await this.resolveName(p.userId));
  }

  private async resolveName(userId: string): Promise<string> {
    const u = await this.userRepo.findOne({ where: { id: userId }, select: ['displayName'] }).catch(() => null);
    return u?.displayName ?? 'Player';
  }

  private addHumanRuntime(live: LiveRound, p: WerkParticipant, displayName?: string): void {
    const [sx, sy] = live.layout.humanSpawn;
    const seat = p.seatIndex;
    const ox = ((seat % 3) - 1) * 8, oy = (Math.floor(seat / 3) - 1) * 8;
    live.humans.set(p.userId, {
      participantId: p.id, userId: p.userId, arbId: HUMAN_ID_BASE + seat,
      name: displayName ?? 'Player', color: HUMAN_COLORS[seat % HUMAN_COLORS.length],
      seatIndex: seat, x: sx + ox, y: sy + oy, input: {}, usePowerLatch: false,
      coinValue: 0, collected: new Set(), stamina: STAMINA_MAX, boost: 0, magnet: 0, shield: 0,
      pendingSpeed: false, pendingMagnet: false, pendingShield: false, connected: true,
    });
  }

  private async startRound(cfg: WerkConfig): Promise<void> {
    const live = this.live!;
    const realCount = live.humans.size;
    const botsEnabled = cfg.botMaxRealPlayers > 0
      ? realCount < cfg.botMaxRealPlayers && ((live.round.botRoster as unknown[])?.length ?? 0) > 0
      : false;

    live.round.status = 'running';
    live.round.startedAt = new Date();
    live.round.botsEnabled = botsEnabled;
    await this.roundRepo.save(live.round);

    for (const p of live.humans.keys()) {
      await this.participantRepo.update({ roundId: live.round.id, userId: p }, { status: 'playing' });
    }

    live.elapsed = 0;
    live.lastTickAt = Date.now();
    this.gateway.emitWerkRoundState(this.roundView(live.round));
    this.logger.log(`Werk round ${live.round.id} started — ${realCount} players, bots=${botsEnabled}`);
  }

  private async cancelRound(reason: string): Promise<void> {
    if (!this.live) return;
    await this.cancelRoundRow(this.live.round, reason);
    this.live = null;
  }

  private async cancelRoundRow(round: WerkRound, reason: string): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const r = await m.findOne(WerkRound, { where: { id: round.id }, lock: { mode: 'pessimistic_write' } });
      if (!r || r.status === 'completed' || r.status === 'cancelled') return;
      // Refund any joined/playing participants.
      const parts = await m.find(WerkParticipant, { where: { roundId: r.id } });
      for (const p of parts) {
        if (p.status === 'settled' || p.status === 'refunded') continue;
        const credit = await this.walletService.creditInSession(
          { userId: p.userId, amountMinor: p.stakeMinor, entryType: 'refund', sourceType: 'werk_round', sourceId: p.id, idempotencyKey: `werk-refund:${p.id}`, metadata: { reason } },
          m,
        );
        p.status = 'refunded';
        p.walletCredit = { ledgerEntryId: credit.ledgerEntry.id };
        p.settledAt = new Date();
        await m.save(p);
      }
      r.status = 'cancelled';
      r.endedAt = new Date();
      r.activeGuard = null;
      await m.save(r);
    });
    this.logger.warn(`Werk round ${round.id} cancelled: ${reason}`);
  }

  private async finalizeAndRotate(cfg: WerkConfig, playable: boolean): Promise<void> {
    if (this.live) {
      await this.roundRepo.update({ id: this.live.round.id }, { activeGuard: null });
      this.live = null;
    }
    // Only open the next lobby if someone is still around to play it.
    if (playable && cfg.enabled && this.gateway.werkPresenceCount() > 0) await this.ensureLobby(cfg);
  }

  // ── Settlement ───────────────────────────────────────────────────────────────

  private async settleRound(cfg: WerkConfig): Promise<void> {
    const live = this.live!;
    if (live.settling) return;
    live.settling = true;
    live.round.status = 'settling';

    try {
      live.botSim.finish();
      const centerCell = live.layout.center;
      const inCenter = (x: number, y: number) => {
        const [cx, cy] = toCell(x, y);
        return cx === centerCell[0] && cy === centerCell[1];
      };

      const humansArr = [...live.humans.values()];
      // Prior games-played per user (this round's rows are not yet 'settled').
      const gamesByUser = new Map<string, number>();
      for (const h of humansArr) {
        gamesByUser.set(h.userId, await this.participantRepo.count({ where: { userId: h.userId, status: 'settled' } }));
      }

      const humans: RoundHuman[] = humansArr.map((h) => ({
        key: h.participantId,
        coinValue: h.coinValue,
        reachedCenter: live.round.mode === 'B' ? inCenter(h.x, h.y) : true,
        gamesPlayed: gamesByUser.get(h.userId) ?? 0,
      }));
      const bots0: RoundBot[] = live.botSim.bots.map((b) => ({ id: b.id, coinValue: b.coinValue, reachedCenter: b.reachedCenter }));

      const payMults = this.werkService.payoutMults(cfg);
      const payingRanks = Math.max(1, payMults.filter((m) => m > 0).length);
      const poolTotal = live.layout.coins.reduce((a, c) => a + c.value, 0);
      const partRows = await this.participantRepo.find({ where: { roundId: live.round.id } });
      const stakeByPart = new Map(partRows.map((p) => [p.id, p.stakeMinor]));

      const result = await this.dataSource.transaction(async (m) => {
        const round = await m.findOne(WerkRound, { where: { id: live.round.id }, lock: { mode: 'pessimistic_write' } });
        if (!round || round.status === 'completed') return null;
        const lockedCfg = await m.findOne(WerkConfig, { where: { key: 'default' }, lock: { mode: 'pessimistic_write' } });
        if (!lockedCfg) throw new BadRequestException('Config unavailable');

        // Periodic forced-loss for larger (non-small) bot-enabled rounds.
        let periodicForceLose = false;
        const notSmall = humans.length >= lockedCfg.houseGuaranteedBelowPlayers;
        if (round.botsEnabled && lockedCfg.winControlEnabled && notSmall && lockedCfg.botForcedWinEveryNRounds > 0) {
          lockedCfg.winControlCounter = (lockedCfg.winControlCounter ?? 0) + 1;
          if (lockedCfg.winControlCounter >= lockedCfg.botForcedWinEveryNRounds) {
            periodicForceLose = true;
            lockedCfg.winControlCounter = 0;
          }
        }

        // Audited randomness for the outcome shaping.
        const draw = await this.rngService.drawSeed({ gameType: 'werk', gameReference: round.id, metadata: { winControl: true }, manager: m });
        const rng = makeRng(draw.numbers[0]);
        const wc = applyRoundWinControl(rng, humans, bots0, {
          mode: round.mode as WinMode,
          botsEnabled: round.botsEnabled,
          realPlayers: humans.length,
          payingRanks,
          poolTotal,
          onboardingEnabled: lockedCfg.onboardingWinControlEnabled,
          onboardingBotWinGames: lockedCfg.onboardingBotWinGames,
          onboardingUserWinGames: lockedCfg.onboardingUserWinGames,
          winControlEnabled: lockedCfg.winControlEnabled,
          houseGuaranteedBelowPlayers: lockedCfg.houseGuaranteedBelowPlayers,
          periodicForceLose,
        });

        const ranked = rankParticipants(round.mode as WinMode, [
          ...humans.map((h) => ({ key: h.key, isHuman: true, coinValue: h.coinValue, reachedCenter: h.reachedCenter })),
          ...wc.bots.map((b) => ({ key: `bot:${b.id}`, isHuman: false, coinValue: b.coinValue, reachedCenter: b.reachedCenter })),
        ]);
        const rankByKey = new Map(ranked.map((r) => [r.key, r]));
        const prizeByPart = new Map<string, number>();
        for (const hr of humansArr) {
          const rr = rankByKey.get(hr.participantId)!;
          prizeByPart.set(hr.participantId, this.werkService.computePrize(lockedCfg, stakeByPart.get(hr.participantId) ?? 0, rr.rank, rr.tieCount, !rr.eligible));
        }

        const standings = ranked.map((r) => {
          if (r.isHuman) {
            const hr = humansArr.find((h) => h.participantId === r.key)!;
            return { id: hr.seatIndex, participantId: hr.participantId, userId: hr.userId, name: hr.name, isHuman: true, color: hr.color, coinValue: r.coinValue, eligible: r.eligible, rank: r.rank, prizeMinor: prizeByPart.get(hr.participantId) ?? 0 };
          }
          const botId = Number(r.key.slice(4));
          const b = live.botSim.bots.find((x) => x.id === botId)!;
          return { id: botId, name: b.name, isHuman: false, color: b.color, coinValue: r.coinValue, eligible: r.eligible, rank: r.rank, prizeMinor: 0 };
        });

        // Persist + pay each participant.
        for (const hr of humansArr) {
          const rr = rankByKey.get(hr.participantId)!;
          const eliminated = !rr.eligible;
          const prize = prizeByPart.get(hr.participantId) ?? 0;
          const p = await m.findOne(WerkParticipant, { where: { id: hr.participantId } });
          if (!p) continue;
          p.coinValue = hr.coinValue;
          p.reachedCenter = live.round.mode === 'B' ? inCenter(hr.x, hr.y) : true;
          p.rank = rr.rank;
          p.tieCount = rr.tieCount;
          p.eliminated = eliminated;
          p.prizeMinor = prize;
          p.status = 'settled';
          p.settledAt = new Date();
          p.resultJson = { winControl: wc.perHuman[hr.participantId] };
          if (prize > 0) {
            const credit = await this.walletService.creditInSession(
              { userId: p.userId, amountMinor: prize, entryType: 'win', sourceType: 'werk_round', sourceId: p.id, idempotencyKey: `werk-prize:${p.id}`, metadata: { rank: rr.rank, tieCount: rr.tieCount, roundId: round.id } },
              m,
            );
            p.walletCredit = { ledgerEntryId: credit.ledgerEntry.id };
          }
          await m.save(p);
        }

        round.status = 'completed';
        round.endedAt = new Date();
        round.resultJson = { standings, winControl: { forced: wc.forced, perHuman: wc.perHuman, auditLogId: draw.auditLogId ?? null } };
        await m.save(lockedCfg);
        await m.save(round);
        return { round, standings };
      });

      if (result) {
        live.round = result.round;
        this.gateway.emitWerkRoundCompleted(this.roundView(result.round));
        this.logger.log(`Werk round ${result.round.id} settled`);
      }
    } catch (err) {
      this.logger.error(`Werk settle failed: ${err instanceof Error ? err.message : err}`);
      // Roll the round back to running so the next lifecycle retries safely.
      live.round.status = 'running';
    } finally {
      live.settling = false;
    }
  }

  // ── Player actions (REST + socket) ───────────────────────────────────────────

  /** Join the current lobby round; debits the stake. Returns the round view. */
  async join(userId: string, stakeMinor?: number): Promise<Record<string, unknown>> {
    const displayName = await this.resolveName(userId);
    await this.gamesService.assertPlayable('werk');
    const cfg = await this.werkService.getConfig();
    if (!cfg.enabled) throw new ForbiddenException('Werk Flega is not available right now');
    if (!this.live || this.live.round.status !== 'lobby') {
      throw new BadRequestException('No open round to join right now — please wait for the next one');
    }
    const live = this.live;
    if (live.humans.has(userId)) return this.roundView(live.round, userId);
    if (live.humans.size >= live.round.maxPlayers) throw new BadRequestException('Round is full');

    const stake = stakeMinor ?? cfg.entryStakeMinor;
    if (stake < cfg.minStakeMinor || stake > cfg.maxStakeMinor) {
      throw new BadRequestException(`Stake must be between ${cfg.minStakeMinor} and ${cfg.maxStakeMinor}`);
    }
    const seat = live.humans.size;

    const participant = await this.dataSource.transaction(async (m) => {
      const p = m.create(WerkParticipant, { roundId: live.round.id, userId, stakeMinor: stake, seatIndex: seat, status: 'joined' });
      await m.save(p);
      const debit = await this.walletService.debitInSession(
        { userId, amountMinor: stake, entryType: 'stake', sourceType: 'werk_round', sourceId: p.id, idempotencyKey: `werk-stake:${p.id}`, metadata: { roundId: live.round.id } },
        m,
      );
      p.walletDebit = { ledgerEntryId: debit.ledgerEntry.id };
      await m.save(p);
      // Stamp the countdown on the first join.
      if (!live.round.scheduledStartAt) {
        live.round.scheduledStartAt = new Date(Date.now() + (cfg.lobbyCountdownSec ?? 15) * 1000);
        await m.save(live.round);
      }
      return p;
    });

    this.addHumanRuntime(live, participant, displayName);
    this.gateway.emitWerkRoundState(this.roundView(live.round));
    return this.roundView(live.round, userId);
  }

  /** Leave the current round. Refunds only while still in the lobby. */
  async leave(userId: string): Promise<{ left: true }> {
    const live = this.live;
    if (!live || !live.humans.has(userId)) return { left: true };
    if (live.round.status === 'lobby') {
      await this.dataSource.transaction(async (m) => {
        const p = await m.findOne(WerkParticipant, { where: { roundId: live.round.id, userId } });
        if (!p || p.status !== 'joined') return;
        const credit = await this.walletService.creditInSession(
          { userId, amountMinor: p.stakeMinor, entryType: 'refund', sourceType: 'werk_round', sourceId: p.id, idempotencyKey: `werk-refund:${p.id}`, metadata: { reason: 'left lobby' } },
          m,
        );
        p.status = 'refunded';
        p.walletCredit = { ledgerEntryId: credit.ledgerEntry.id };
        p.settledAt = new Date();
        await m.save(p);
      });
      live.humans.delete(userId);
      this.gateway.emitWerkRoundState(this.roundView(live.round));
    }
    // While running, leaving forfeits the stake (they simply stop sending input).
    return { left: true };
  }

  handleInput(userId: string, raw: unknown): void {
    const live = this.live;
    if (!live || live.round.status !== 'running') return;
    const h = live.humans.get(userId);
    if (!h) return;
    const input = (raw ?? {}) as WerkInput;
    h.input = {
      moveX: typeof input.moveX === 'number' ? Math.max(-1, Math.min(1, input.moveX)) : 0,
      moveY: typeof input.moveY === 'number' ? Math.max(-1, Math.min(1, input.moveY)) : 0,
      sprint: !!input.sprint,
    };
    if (input.usePower) h.usePowerLatch = true;
  }

  /** Current round view for the lobby/spectator REST endpoint. */
  getCurrentView(userId?: string): Record<string, unknown> | null {
    if (!this.live) return null;
    return this.roundView(this.live.round, userId);
  }

  // ── Views + broadcasts ───────────────────────────────────────────────────────

  private roundView(round: WerkRound, userId?: string): { id: string } & Record<string, unknown> {
    const live = this.live && this.live.round.id === round.id ? this.live : null;
    const you = userId && live ? live.humans.get(userId) : undefined;
    const timeLeft = round.status === 'running' && live ? Math.max(0, round.durationSec - live.elapsed) : (round.status === 'lobby' ? round.durationSec : 0);
    const countdown = round.scheduledStartAt && round.status === 'lobby'
      ? Math.max(0, Math.ceil((round.scheduledStartAt.getTime() - Date.now()) / 1000)) : null;
    return {
      id: round.id,
      status: round.status,
      seed: Number(round.seed),
      mode: round.mode,
      durationSec: round.durationSec,
      coinDensityX100: round.coinDensityX100,
      finalSprintWarningSec: round.finalSprintWarningSec,
      powerupsEnabled: round.powerupsEnabled,
      maxPlayers: round.maxPlayers,
      botCount: (round.botRoster as unknown[] | null)?.length ?? 0,
      botsEnabled: round.botsEnabled,
      bots: (round.botRoster as WerkBotDescriptor[] | null) ?? [],
      timeLeft,
      countdown,
      playerCount: live ? live.humans.size : 0,
      players: live ? [...live.humans.values()].map((h) => ({ participantId: h.participantId, userId: h.userId, seat: h.seatIndex, name: h.name, color: h.color })) : [],
      yourParticipantId: you?.participantId ?? null,
      yourSeat: you?.seatIndex ?? null,
      standings: (round.resultJson as { standings?: unknown[] } | null)?.standings ?? [],
    };
  }

  private broadcastSnapshot(live: LiveRound): void {
    const players: Array<Record<string, unknown>> = [];
    for (const h of live.humans.values()) {
      players.push({ id: h.arbId, seat: h.seatIndex, name: h.name, color: h.color, isBot: false, x: Math.round(h.x), y: Math.round(h.y), coinValue: h.coinValue, stamina: Math.round(h.stamina), boost: h.boost > 0, magnet: h.magnet > 0 });
    }
    if (live.round.botsEnabled) {
      for (const b of live.botSim.bots) {
        players.push({ id: b.id, name: b.name, color: b.color, isBot: true, x: Math.round(b.x), y: Math.round(b.y), coinValue: b.coinValue });
      }
    }
    this.gateway.emitWerkSnapshot(live.round.id, {
      t: Date.now(),
      status: live.round.status,
      timeLeft: Math.max(0, live.round.durationSec - live.elapsed),
      players,
      taken: [...live.coinOwner.keys()],
      powerupsTaken: [...live.takenPowerups],
    });
  }
}
