import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, Table } from 'typeorm';
import { GamesService } from '../games/games.service';
import { RngService } from '../rng/rng.service';
import { WalletService } from '../wallet/wallet.service';
import { WerkConfig } from './entities/werk-config.entity';
import { WerkSession } from './entities/werk-session.entity';
import { UpdateWerkConfigDto } from './dto/update-werk-config.dto';
import { StartWerkGameDto } from './dto/start-werk-game.dto';
import { SettleWerkGameDto } from './dto/settle-werk-game.dto';
import { buildBotRoster, type WerkBotDescriptor } from './werk-bots';
import {
  buildLayout, simulateBots, computeStandings, makeRng, SIM_DT, CELL, HUMAN_SPEED,
  type BotConfig, type BotResult, type StandingRow,
} from './sim';

/** Public config the client needs to render + play a game (no secrets). */
export type WerkConfigView = {
  enabled: boolean;
  entryStakeMinor: number;
  minStakeMinor: number;
  maxStakeMinor: number;
  totalPlayers: number;
  botCount: number;
  gameDurationSec: number;
  winningMode: 'A' | 'B';
  finalSprintWarningSec: number;
  coinDensityX100: number;
  powerupsEnabled: boolean;
  mazeTheme: string;
  payoutMultsX100: number[]; // index 0 = rank 1
};

/** A started game: everything the client needs to build the identical maze. */
export type WerkSessionView = {
  id: string;
  status: 'active' | 'settled' | 'aborted';
  seed: number;
  stakeMinor: number;
  mode: 'A' | 'B';
  durationSec: number;
  totalPlayers: number;
  botCount: number;
  coinDensityX100: number;
  finalSprintWarningSec: number;
  powerupsEnabled: boolean;
  mazeTheme: string;
  payoutMultsX100: number[];
  /** Server-authoritative bot roster — the client renders exactly these. */
  bots: WerkBotDescriptor[];
  // Present once settled:
  humanRank: number | null;
  prizeMinor: number;
  /** Official final standings, authoritative. Empty until settled. */
  standings: StandingRow[];
};

const PAYOUT_FIELDS = [
  'payoutRank1MultX100',
  'payoutRank2MultX100',
  'payoutRank3MultX100',
  'payoutRank4MultX100',
  'payoutRank5MultX100',
] as const;

@Injectable()
export class WerkService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WerkService.name);
  private tablesEnsured = false;

  constructor(
    @InjectRepository(WerkConfig)
    private readonly configRepo: Repository<WerkConfig>,
    @InjectRepository(WerkSession)
    private readonly sessionRepo: Repository<WerkSession>,
    private readonly dataSource: DataSource,
    private readonly rngService: RngService,
    private readonly walletService: WalletService,
    private readonly gamesService: GamesService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.getConfig().catch((err) =>
      this.logger.warn(`Werk config seed skipped: ${err instanceof Error ? err.message : err}`),
    );
  }

  /**
   * Self-heal: create the werk tables if they don't exist, so the feature works
   * on a plain restart even when the boot-time schema sync was skipped. Mirrors
   * PoolService / GamesService.
   */
  private async ensureTables(): Promise<void> {
    if (this.tablesEnsured) return;
    const qr = this.dataSource.createQueryRunner();
    try {
      await qr.connect();
      for (const entity of [WerkConfig, WerkSession]) {
        const meta = this.dataSource.getMetadata(entity);
        if (!(await qr.hasTable(meta.tableName))) {
          await qr.createTable(Table.create(meta, this.dataSource.driver), true);
          this.logger.log(`Self-healed: created ${meta.tableName} table`);
        }
      }
      this.tablesEnsured = true;
    } catch (err) {
      this.logger.warn(`ensureTables failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      await qr.release();
    }
  }

  // ── Config ────────────────────────────────────────────────────────────────

  /** Read the single config row, creating defaults on first access. */
  async getConfig(): Promise<WerkConfig> {
    await this.ensureTables();
    let cfg = await this.configRepo.findOneBy({ key: 'default' });
    if (!cfg) {
      cfg = this.configRepo.create({ key: 'default' });
      await this.configRepo.save(cfg);
    }
    return cfg;
  }

  private payoutMults(cfg: WerkConfig): number[] {
    return PAYOUT_FIELDS.map((f) => cfg[f]);
  }

  /** Bots that will actually spawn: none in `zero` mode, else clamped to leave the human a seat. */
  private effectiveBotCount(cfg: WerkConfig): number {
    if (cfg.botSeedMode === 'zero') return 0;
    return Math.max(0, Math.min(cfg.botCount, cfg.totalPlayers - 1));
  }

  toConfigView(cfg: WerkConfig): WerkConfigView {
    return {
      enabled: cfg.enabled,
      entryStakeMinor: cfg.entryStakeMinor,
      minStakeMinor: cfg.minStakeMinor,
      maxStakeMinor: cfg.maxStakeMinor,
      totalPlayers: cfg.totalPlayers,
      botCount: this.effectiveBotCount(cfg),
      gameDurationSec: cfg.gameDurationSec,
      winningMode: cfg.winningMode,
      finalSprintWarningSec: cfg.finalSprintWarningSec,
      coinDensityX100: cfg.coinDensityX100,
      powerupsEnabled: cfg.powerupsEnabled,
      mazeTheme: cfg.mazeTheme,
      payoutMultsX100: this.payoutMults(cfg),
    };
  }

  async getConfigView(): Promise<WerkConfigView> {
    return this.toConfigView(await this.getConfig());
  }

  async updateConfig(dto: UpdateWerkConfigDto, adminId: string): Promise<WerkConfig> {
    const cfg = await this.getConfig();
    Object.assign(cfg, dto);

    // Cross-field invariants.
    if (cfg.minStakeMinor > cfg.maxStakeMinor) {
      throw new BadRequestException('minStakeMinor cannot exceed maxStakeMinor');
    }
    if (cfg.entryStakeMinor < cfg.minStakeMinor || cfg.entryStakeMinor > cfg.maxStakeMinor) {
      throw new BadRequestException('entryStakeMinor must be within the stake range');
    }
    if (cfg.botCount > cfg.totalPlayers - 1) {
      throw new BadRequestException('botCount must leave room for the human (botCount <= totalPlayers - 1)');
    }

    cfg.updatedBy = adminId;
    return this.configRepo.save(cfg);
  }

  // ── Play ──────────────────────────────────────────────────────────────────

  private toSessionView(s: WerkSession, cfg: WerkConfig): WerkSessionView {
    return {
      id: s.id,
      status: s.status,
      seed: Number(s.seed),
      stakeMinor: s.stakeMinor,
      mode: s.mode,
      durationSec: s.durationSec,
      totalPlayers: s.totalPlayers,
      botCount: s.botCount,
      // Layout params come from the SESSION snapshot so the client builds the
      // exact maze the server will rebuild at settle (mazeTheme is cosmetic only).
      coinDensityX100: s.coinDensityX100,
      finalSprintWarningSec: s.finalSprintWarningSec,
      powerupsEnabled: s.powerupsEnabled,
      mazeTheme: cfg.mazeTheme,
      payoutMultsX100: this.payoutMults(cfg),
      bots: (s.botRoster as WerkBotDescriptor[] | null) ?? [],
      humanRank: s.humanRank,
      prizeMinor: s.prizeMinor,
      standings: ((s.resultJson as { standings?: StandingRow[] } | null)?.standings) ?? [],
    };
  }

  /** Start a game: debit the stake, draw an audited layout seed, return the view. */
  async startGame(userId: string, dto: StartWerkGameDto): Promise<WerkSessionView> {
    await this.gamesService.assertPlayable('werk');
    const cfg = await this.getConfig();
    if (!cfg.enabled) throw new ForbiddenException('Werk Flega is not available right now');

    const stake = dto.stakeMinor ?? cfg.entryStakeMinor;
    if (stake < cfg.minStakeMinor || stake > cfg.maxStakeMinor) {
      throw new BadRequestException(`Stake must be between ${cfg.minStakeMinor} and ${cfg.maxStakeMinor}`);
    }

    const botCount = this.effectiveBotCount(cfg);

    const session = await this.dataSource.transaction(async (manager) => {
      // Persist the session first so its id can anchor the stake + RNG audit rows.
      const created = manager.create(WerkSession, {
        userId,
        status: 'active',
        stakeMinor: stake,
        mode: cfg.winningMode,
        durationSec: cfg.gameDurationSec,
        totalPlayers: 1 + botCount,
        botCount,
        coinDensityX100: cfg.coinDensityX100,
        finalSprintWarningSec: cfg.finalSprintWarningSec,
        powerupsEnabled: cfg.powerupsEnabled,
        seed: 0,
        humanEliminated: false,
        coinValue: 0,
        prizeMinor: 0,
      });
      await manager.save(created);

      const debit = await this.walletService.debitInSession(
        {
          userId,
          amountMinor: stake,
          entryType: 'stake',
          sourceType: 'werk_game',
          sourceId: created.id,
          idempotencyKey: `werk-stake:${created.id}`,
          metadata: { mode: cfg.winningMode },
        },
        manager,
      );

      const draw = await this.rngService.drawSeed({
        gameType: 'werk',
        gameReference: created.id,
        metadata: { totalPlayers: cfg.totalPlayers, botCount, mode: cfg.winningMode },
        manager,
      });

      created.seed = draw.numbers[0];
      created.seedAuditLogId = draw.auditLogId ?? null;
      created.walletDebit = { ledgerEntryId: debit.ledgerEntry.id };
      // Deterministically generate the bot roster from the audited seed + config.
      created.botRoster = buildBotRoster(created.seed, botCount, {
        botSeedMode: cfg.botSeedMode,
        botSpeedPct: cfg.botSpeedPct,
        botSkillPct: cfg.botSkillPct,
        botPersonalities: cfg.botPersonalities,
      });
      await manager.save(created);
      return created;
    });

    return this.toSessionView(session, cfg);
  }

  async getSession(userId: string, id: string): Promise<WerkSessionView> {
    const s = await this.sessionRepo.findOneBy({ id });
    if (!s || s.userId !== userId) throw new NotFoundException('Game not found');
    return this.toSessionView(s, await this.getConfig());
  }

  /**
   * Server-authoritative prize for a final rank. Eliminated players and ranks
   * outside the paytable win nothing; a tie splits the rank's prize equally.
   */
  private computePrize(cfg: WerkConfig, stake: number, rank: number, tieCount: number, eliminated: boolean): number {
    if (eliminated) return 0;
    const mults = this.payoutMults(cfg);
    if (rank < 1 || rank > mults.length) return 0;
    const mult = mults[rank - 1];
    if (mult <= 0) return 0;
    const rankPrize = Math.floor((stake * mult) / 100);
    return Math.floor(rankPrize / Math.max(1, tieCount));
  }

  /**
   * Settle authoritatively. The server rebuilds the exact maze the client played,
   * re-derives the human's coin value from the reported indices (validated for
   * plausibility), simulates the bot field itself, applies the house-edge win
   * controller, and computes rank + prize. Nothing the client sends is trusted
   * for money beyond "which coins did I touch" (bounded) and Mode-B centre arrival.
   */
  async settle(userId: string, id: string, dto: SettleWerkGameDto): Promise<WerkSessionView> {
    const settled = await this.dataSource.transaction(async (manager) => {
      const s = await manager.findOne(WerkSession, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!s || s.userId !== userId) throw new NotFoundException('Game not found');
      if (s.status === 'aborted') throw new BadRequestException('Game was aborted');
      if (s.status === 'settled') return s; // idempotent

      // Lock the config row too — the win controller mutates its rolling counter.
      const cfg = await manager.findOne(WerkConfig, { where: { key: 'default' }, lock: { mode: 'pessimistic_write' } });
      if (!cfg) throw new BadRequestException('Config unavailable');

      const roster = (s.botRoster as BotConfig[] | null) ?? [];
      const layout = buildLayout(Number(s.seed), {
        totalPlayers: s.totalPlayers, coinDensityX100: s.coinDensityX100,
        powerupsEnabled: s.powerupsEnabled, botCount: s.botCount,
      });

      // ── Validate the human's collected coins against the server's own layout ──
      const coinCount = layout.coins.length;
      const seen = new Set<number>();
      for (const idx of dto.collectedCoinIndices) {
        if (Number.isInteger(idx) && idx >= 0 && idx < coinCount) seen.add(idx);
      }
      let humanValue = 0;
      for (const idx of seen) humanValue += layout.coins[idx].value;
      // Plausibility: a human can't visit more cells than max speed allows.
      const maxReach = Math.min(coinCount, Math.ceil((s.durationSec * HUMAN_SPEED) / CELL * 1.2));
      if (seen.size > maxReach) {
        humanValue = [...seen]
          .map((i) => layout.coins[i].value)
          .sort((a, b) => b - a)
          .slice(0, maxReach)
          .reduce((a, b) => a + b, 0);
      }
      const reachedCenter = s.mode === 'B' ? !!dto.reachedCenter : true;

      // ── Authoritative bot field ──────────────────────────────────────────────
      let bots = simulateBots(layout, roster, {
        mode: s.mode, durationSec: s.durationSec, finalSprintWarningSec: s.finalSprintWarningSec,
      }, SIM_DT);

      // ── House-edge win control (RNG-audited) ─────────────────────────────────
      const wc = await this.applyWinControl(manager, cfg, s, humanValue, bots, layout);
      bots = wc.bots;

      const std = computeStandings(
        s.mode,
        { coinValue: humanValue, reachedCenter, name: 'You', color: '#f5f5f5' },
        bots,
      );
      const eliminated = !std.humanEligible;
      const prize = this.computePrize(cfg, s.stakeMinor, std.humanRank, std.humanTieCount, eliminated);

      s.humanRank = std.humanRank;
      s.tieCount = std.humanTieCount;
      s.humanEliminated = eliminated;
      s.coinValue = humanValue;
      s.prizeMinor = prize;
      s.resultJson = {
        humanValue, reachedCenter, standings: std.rows,
        winControl: wc.info, winControlAuditId: wc.auditLogId,
        settledAt: new Date().toISOString(),
      };

      if (prize > 0) {
        const credit = await this.walletService.creditInSession(
          {
            userId, amountMinor: prize, entryType: 'win', sourceType: 'werk_game', sourceId: s.id,
            idempotencyKey: `werk-prize:${s.id}`,
            metadata: { rank: std.humanRank, tieCount: std.humanTieCount, forced: wc.info.forced },
          },
          manager,
        );
        s.walletCredit = { ledgerEntryId: credit.ledgerEntry.id };
      }

      s.status = 'settled';
      s.settledAt = new Date();
      await manager.save(cfg);
      await manager.save(s);
      return s;
    });

    return this.toSessionView(settled, await this.getConfig());
  }

  /**
   * Shape the outcome for house edge. Small games (participants below the
   * threshold) always let the house win — the human is forced strictly below
   * every bot. Larger games force a randomly chosen bot above the human every Nth
   * settled round. The random choice + margins are drawn through the RNG service
   * (they are outcomes) and audited. Mutates `cfg.winControlCounter` (persisted by
   * the caller within the same transaction).
   */
  private async applyWinControl(
    manager: EntityManager,
    cfg: WerkConfig,
    s: WerkSession,
    humanValue: number,
    bots: BotResult[],
    layout: { coins: Array<{ value: number }> },
  ): Promise<{ bots: BotResult[]; info: Record<string, unknown>; auditLogId: string | null }> {
    const info: Record<string, unknown> = { forced: false, mode: 'none' };
    if (!cfg.winControlEnabled || bots.length === 0) {
      return { bots, info, auditLogId: null };
    }

    const participants = s.totalPlayers;
    const small = participants < cfg.houseGuaranteedBelowPlayers;
    let force = false;
    let forceAll = false;
    if (small) {
      force = true;
      forceAll = true;
    } else if (cfg.botForcedWinEveryNRounds > 0) {
      cfg.winControlCounter = (cfg.winControlCounter ?? 0) + 1;
      if (cfg.winControlCounter >= cfg.botForcedWinEveryNRounds) {
        force = true;
        cfg.winControlCounter = 0;
      }
    }
    info.counter = cfg.winControlCounter;
    if (!force) return { bots, info, auditLogId: null };

    // Audited randomness for who wins + by how much.
    const draw = await this.rngService.drawSeed({
      gameType: 'werk', gameReference: s.id, metadata: { winControl: true, forceAll }, manager,
    });
    const rng = makeRng(draw.numbers[0]);
    const poolTotal = layout.coins.reduce((a, c) => a + c.value, 0);
    const out = bots.map((b) => ({ ...b }));

    if (forceAll) {
      // Every bot strictly above the human, in a randomised order so the "winner" varies.
      const order = out.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      order.forEach((botIdx, pos) => {
        const target = humanValue + 1 + (order.length - 1 - pos) * 5 + Math.floor(rng() * 4);
        out[botIdx].coinValue = Math.min(poolTotal, Math.max(out[botIdx].coinValue, target));
        out[botIdx].reachedCenter = true;
      });
      info.mode = 'all';
    } else {
      // One random bot above the human — the human just can't take 1st.
      const r = Math.floor(rng() * out.length);
      const target = humanValue + 1 + Math.floor(rng() * 20);
      out[r].coinValue = Math.min(poolTotal, Math.max(out[r].coinValue, target));
      out[r].reachedCenter = true;
      info.mode = 'one';
      info.winnerBotId = out[r].id;
    }
    info.forced = true;
    return { bots: out, info, auditLogId: draw.auditLogId ?? null };
  }

  /** Abort an unfinished game (player left early): refund the stake, no prize. */
  async abort(userId: string, id: string): Promise<WerkSessionView> {
    const cfg = await this.getConfig();

    const aborted = await this.dataSource.transaction(async (manager) => {
      const s = await manager.findOne(WerkSession, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!s || s.userId !== userId) throw new NotFoundException('Game not found');
      if (s.status === 'settled') throw new BadRequestException('Game already settled');
      if (s.status === 'aborted') return s; // idempotent

      await this.walletService.creditInSession(
        {
          userId,
          amountMinor: s.stakeMinor,
          entryType: 'refund',
          sourceType: 'werk_game',
          sourceId: s.id,
          idempotencyKey: `werk-refund:${s.id}`,
          metadata: { reason: 'aborted' },
        },
        manager,
      );

      s.status = 'aborted';
      s.settledAt = new Date();
      await manager.save(s);
      return s;
    });

    return this.toSessionView(aborted, cfg);
  }
}
