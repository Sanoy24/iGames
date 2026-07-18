import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { RngService } from '../rng/rng.service';
import { WalletService } from '../wallet/wallet.service';
import { GameEventsGateway } from '../events/game-events.gateway';
import { PoolMatch } from './entities/pool-match.entity';
import { PoolShot } from './entities/pool-shot.entity';
import { PoolConfig } from './entities/pool-config.entity';
import { PoolMode, PoolService } from './pool.service';
import { PoolBotService } from './pool-bot.service';
import { PoolTournamentService } from './pool-tournament.service';
import { runShot, ShotTuning } from './engine/simulator';
import { ShotInput, TableSpec } from './engine/types';
import { snapshotFromConfig, buildTable, buildTuning, PoolPhysicsSnapshot } from './pool-physics';
import { GameState, Seat, ShotOutcome } from './rules/rules-types';
import { newGame, otherSeat, resolveShot } from './rules/rules';

export interface CreateMatchInput {
  mode: PoolMode;
  seatAUserId: string | null;
  seatBUserId: string | null;
  stakeMinor?: number;
  breaker?: Seat;
  tournamentId?: string | null;
  tournamentRound?: number | null;
  tournamentSlot?: number | null;
}

const MAX_BOT_SHOTS_PER_TURN = 40;

@Injectable()
export class PoolMatchService {
  private readonly logger = new Logger(PoolMatchService.name);

  /** Build the engine table + cue tuning from a match's snapshotted physics. */
  private physicsFor(match: PoolMatch): { table: TableSpec; tuning: ShotTuning } {
    const snap = snapshotFromConfig((match.physics ?? {}) as Partial<PoolPhysicsSnapshot>);
    return { table: buildTable(snap), tuning: buildTuning(snap) };
  }

  constructor(
    @InjectRepository(PoolMatch)
    private readonly matchRepo: Repository<PoolMatch>,
    @InjectRepository(PoolShot)
    private readonly shotRepo: Repository<PoolShot>,
    private readonly dataSource: DataSource,
    private readonly rngService: RngService,
    private readonly poolService: PoolService,
    private readonly walletService: WalletService,
    private readonly gateway: GameEventsGateway,
    private readonly botService: PoolBotService,
    @Inject(forwardRef(() => PoolTournamentService))
    private readonly tournamentService: PoolTournamentService,
  ) {}

  // ── Creation ────────────────────────────────────────────────────────────────

  /** Create + rack a match. Pass `manager` to enlist in an outer transaction. */
  async createMatch(input: CreateMatchInput, manager?: EntityManager): Promise<PoolMatch> {
    const cfg = await this.poolService.getConfig();
    const breaker: Seat = input.breaker ?? 'A';
    // Pre-generate the id so the RNG audit row can reference this exact match.
    const matchId = randomUUID();
    const draw = await this.rngService.drawUniqueNumbers({
      min: 1,
      max: 2_000_000_000,
      count: 1,
      gameType: 'pool',
      gameReference: matchId,
      metadata: { purpose: 'rack', mode: input.mode, tournamentId: input.tournamentId ?? null },
      manager,
    });
    const seed = draw.numbers[0];
    const physics = snapshotFromConfig(cfg as Partial<PoolPhysicsSnapshot>);
    const state = newGame(buildTable(physics), seed, breaker);
    const repo = manager ? manager.getRepository(PoolMatch) : this.matchRepo;

    const match = repo.create({
      id: matchId,
      mode: input.mode,
      physics,
      status: 'active',
      seatAUserId: input.seatAUserId,
      seatBUserId: input.seatBUserId,
      stakeMinor: input.stakeMinor ?? 0,
      rackSeed: seed,
      seedHash: draw.randomnessMaterialHash,
      engineVersion: cfg.engineVersion,
      rulesetVersion: cfg.rulesetVersion,
      breakerSeat: breaker,
      turn: state.turn,
      groupA: null,
      groupB: null,
      tableOpen: true,
      ballInHand: false,
      phase: 'break',
      winnerSeat: null,
      board: state.balls,
      shotCount: 0,
      turnDeadline: this.deadlineFrom(cfg),
      tournamentId: input.tournamentId ?? null,
      tournamentRound: input.tournamentRound ?? null,
      tournamentSlot: input.tournamentSlot ?? null,
    });
    const saved = await repo.save(match);
    if (!manager) this.broadcastMatch(saved);
    return saved;
  }

  /** Single-player vs the AI, escrowing the configured stake if any. */
  async createSingleMatch(userId: string): Promise<PoolMatch> {
    const cfg = await this.poolService.getConfig();
    const stake = cfg.singlePlayerStakeMinor;
    if (stake <= 0) {
      return this.createMatch({ mode: 'single', seatAUserId: userId, seatBUserId: null, stakeMinor: 0 });
    }
    const match = await this.dataSource.transaction(async (manager) => {
      const m = await this.createMatch(
        { mode: 'single', seatAUserId: userId, seatBUserId: null, stakeMinor: stake },
        manager,
      );
      await this.walletService.debitInSession(
        {
          userId,
          amountMinor: stake,
          entryType: 'stake',
          sourceType: 'pool_match',
          sourceId: m.id,
          idempotencyKey: `pool-stake:${m.id}:A`,
          metadata: { mode: 'single' },
        },
        manager,
      );
      return m;
    });
    this.broadcastMatch(match);
    return match;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async getMatch(id: string): Promise<PoolMatch> {
    const match = await this.matchRepo.findOneBy({ id });
    if (!match) throw new NotFoundException('Match not found');
    return match;
  }

  async getShots(matchId: string): Promise<PoolShot[]> {
    return this.shotRepo.find({ where: { matchId }, order: { shotIndex: 'ASC' } });
  }

  private toState(m: PoolMatch): GameState {
    return {
      balls: m.board,
      turn: m.turn,
      groups: { A: m.groupA, B: m.groupB },
      tableOpen: m.tableOpen,
      ballInHand: m.ballInHand,
      phase: m.phase,
      winner: m.winnerSeat,
    };
  }

  private seatOf(match: PoolMatch, userId: string): Seat {
    if (match.seatAUserId === userId) return 'A';
    if (match.seatBUserId === userId) return 'B';
    throw new ForbiddenException('You are not a player in this match');
  }

  private deadlineFrom(cfg: PoolConfig): Date | null {
    return cfg.shotClockSeconds > 0 ? new Date(Date.now() + cfg.shotClockSeconds * 1000) : null;
  }

  private validateInput(match: PoolMatch, input: ShotInput): void {
    const finite = (n: number) => typeof n === 'number' && Number.isFinite(n);
    if (!finite(input.angle) || !finite(input.power)) {
      throw new BadRequestException('angle and power must be finite numbers');
    }
    if (input.power < 0 || input.power > 1) {
      throw new BadRequestException('power must be between 0 and 1');
    }
    if (!input.spin || !finite(input.spin.side) || !finite(input.spin.vertical)) {
      throw new BadRequestException('spin.side and spin.vertical are required numbers');
    }
    if (Math.abs(input.spin.side) > 1 || Math.abs(input.spin.vertical) > 1) {
      throw new BadRequestException('spin values must be within [-1, 1]');
    }
    if (input.cuePos) {
      if (!match.ballInHand) {
        throw new BadRequestException('Cue placement is only allowed with ball in hand');
      }
      const { table } = this.physicsFor(match);
      const R = table.ballRadius;
      const { x, y } = input.cuePos;
      if (!finite(x) || !finite(y) || x < R || x > table.width - R || y < R || y > table.height - R) {
        throw new BadRequestException('Cue placement is outside the table');
      }
      const clash = match.board.some(
        (b) => b.number !== 0 && !b.pocketed && Math.hypot(b.pos.x - x, b.pos.y - y) < 2 * R,
      );
      if (clash) throw new BadRequestException('Cue placement overlaps another ball');
    }
  }

  // ── Shooting ────────────────────────────────────────────────────────────────

  /** A human player submits a shot; bot replies are then auto-played in single. */
  async submitShot(matchId: string, userId: string, input: ShotInput): Promise<ShotOutcome> {
    const match = await this.getMatch(matchId);
    if (match.status !== 'active') throw new ConflictException('Match is not active');
    const seat = this.seatOf(match, userId);
    if (seat !== match.turn) throw new ConflictException('It is not your turn');
    this.validateInput(match, input);

    const { outcome, match: after } = await this.applyResolvedShot(matchId, seat, input);

    if (after.mode === 'single' && after.status === 'active') {
      const botSeat: Seat | null =
        after.seatBUserId === null ? 'B' : after.seatAUserId === null ? 'A' : null;
      if (botSeat && after.turn === botSeat) await this.runBotTurns(matchId, botSeat);
    }
    return outcome;
  }

  /** Run, resolve, persist, settle and broadcast one shot in a transaction. */
  private async applyResolvedShot(
    matchId: string,
    seat: Seat,
    input: ShotInput,
  ): Promise<{ outcome: ShotOutcome; match: PoolMatch }> {
    const match = await this.getMatch(matchId);
    const cfg = await this.poolService.getConfig();
    const { table, tuning } = this.physicsFor(match);
    const pre = this.toState(match);
    const result = runShot(pre.balls, input, table, { tuning });
    const outcome = resolveShot(pre, result, table);
    const shotIndex = match.shotCount;
    const s = outcome.state;

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(PoolShot).insert({
          matchId: match.id,
          shotIndex,
          seat,
          input,
          pocketed: outcome.pocketed,
          fouls: outcome.fouls,
          turnPassed: outcome.turnPassed,
          assignedGroups: outcome.assignedGroups,
          gameOver: outcome.gameOver,
          winnerSeat: outcome.winner,
          reason: outcome.reason,
          boardAfter: s.balls,
        });

        let settledAt: Date | null = null;
        if (outcome.gameOver && outcome.winner) {
          const settled = await this.settleWithinTx(manager, match, outcome.winner, cfg);
          if (settled) settledAt = new Date();
        }

        const res = await manager.getRepository(PoolMatch).update(
          { id: match.id, shotCount: shotIndex },
          {
            board: s.balls,
            turn: s.turn,
            groupA: s.groups.A,
            groupB: s.groups.B,
            tableOpen: s.tableOpen,
            ballInHand: s.ballInHand,
            phase: s.phase,
            winnerSeat: s.winner,
            shotCount: shotIndex + 1,
            status: outcome.gameOver ? 'completed' : 'active',
            completedAt: outcome.gameOver ? new Date() : null,
            settledAt,
            turnDeadline: outcome.gameOver ? null : this.deadlineFrom(cfg),
          },
        );
        if (!res.affected) throw new ConflictException('Shot already applied');
      });
    } catch (err) {
      if (isDuplicateKey(err)) throw new ConflictException('Shot already applied');
      throw err;
    }

    const fresh = await this.getMatch(matchId);
    this.broadcastShot(matchId, seat, input, outcome);
    this.broadcastMatch(fresh);
    if (outcome.gameOver) {
      this.gateway.emitPoolMatchEnded(matchId, { matchId, winnerSeat: outcome.winner, reason: outcome.reason });
      if (fresh.tournamentId) {
        await this.tournamentService
          .onMatchCompleted(fresh)
          .catch((e) => this.logger.error(`Tournament advance failed: ${e?.message ?? e}`));
      }
    }
    return { outcome, match: fresh };
  }

  private async runBotTurns(matchId: string, botSeat: Seat): Promise<void> {
    const cfg = await this.poolService.getConfig();
    for (let i = 0; i < MAX_BOT_SHOTS_PER_TURN; i++) {
      const match = await this.getMatch(matchId);
      if (match.status !== 'active' || match.turn !== botSeat) break;
      const { table } = this.physicsFor(match);
      const input = await this.botService.computeShot(this.toState(match), botSeat, cfg.botDifficulty, table);
      await this.applyResolvedShot(matchId, botSeat, input);
    }
  }

  // ── Settlement / lifecycle ──────────────────────────────────────────────────

  /** Credit the winner (minus rake). Tournament matches settle via prize pool. */
  private async settleWithinTx(
    manager: EntityManager,
    match: PoolMatch,
    winner: Seat,
    cfg: PoolConfig,
  ): Promise<boolean> {
    if (match.settledAt) return false;
    if (match.mode === 'tournament') return false; // prize handled at tournament end
    if (match.stakeMinor <= 0) return false;

    const winnerUserId = winner === 'A' ? match.seatAUserId : match.seatBUserId;
    if (!winnerUserId) return false; // bot won a single-player game — nothing to pay

    const pot = match.stakeMinor * 2;
    const rake = Math.floor((pot * cfg.rakePct) / 100);
    const payout = pot - rake;
    await this.walletService.creditInSession(
      {
        userId: winnerUserId,
        amountMinor: payout,
        entryType: 'win',
        sourceType: 'pool_match',
        sourceId: match.id,
        idempotencyKey: `pool-payout:${match.id}`,
        metadata: { mode: match.mode, pot, rake },
      },
      manager,
    );
    return true;
  }

  /**
   * Abort a match and refund both stakes. Idempotent per seat. Used for
   * cancellations / unrecoverable errors (not normal completion).
   */
  async abortMatch(matchId: string, reason: string): Promise<void> {
    const match = await this.getMatch(matchId);
    if (match.status !== 'active') return;
    await this.dataSource.transaction(async (manager) => {
      if (match.mode !== 'tournament' && match.stakeMinor > 0 && !match.settledAt) {
        for (const [seat, userId] of [['A', match.seatAUserId], ['B', match.seatBUserId]] as const) {
          if (!userId) continue;
          await this.walletService.creditInSession(
            {
              userId,
              amountMinor: match.stakeMinor,
              entryType: 'refund',
              sourceType: 'pool_match',
              sourceId: match.id,
              idempotencyKey: `pool-refund:${match.id}:${seat}`,
              metadata: { reason },
            },
            manager,
          );
        }
      }
      await manager.getRepository(PoolMatch).update(
        { id: match.id, status: 'active' },
        { status: 'aborted', settledAt: new Date(), turnDeadline: null, completedAt: new Date() },
      );
    });
    this.gateway.emitPoolMatchEnded(matchId, { matchId, aborted: true, reason });
  }

  /**
   * Award the match to the opponent because the player on turn ran out their
   * shot clock (or disconnected). Called by the scheduler; idempotent via the
   * status guard.
   */
  async forfeitOnTimeout(matchId: string): Promise<void> {
    const match = await this.getMatch(matchId);
    if (match.status !== 'active') return;
    if (!match.turnDeadline || match.turnDeadline.getTime() > Date.now()) return;

    const winner = otherSeat(match.turn);
    const cfg = await this.poolService.getConfig();
    await this.dataSource.transaction(async (manager) => {
      let settledAt: Date | null = null;
      const settled = await this.settleWithinTx(manager, match, winner, cfg);
      if (settled) settledAt = new Date();
      const res = await manager.getRepository(PoolMatch).update(
        { id: match.id, status: 'active', shotCount: match.shotCount },
        {
          status: 'completed',
          phase: 'gameover',
          winnerSeat: winner,
          turnDeadline: null,
          completedAt: new Date(),
          settledAt,
        },
      );
      if (!res.affected) throw new ConflictException('Match already advanced');
    });

    const fresh = await this.getMatch(matchId);
    this.broadcastMatch(fresh);
    this.gateway.emitPoolMatchEnded(matchId, {
      matchId,
      winnerSeat: winner,
      reason: `${match.turn} ran out of time — ${winner} wins by forfeit`,
    });
    if (fresh.tournamentId) {
      await this.tournamentService
        .onMatchCompleted(fresh)
        .catch((e) => this.logger.error(`Tournament advance failed: ${e?.message ?? e}`));
    }
  }

  /** Active matches whose shot clock has expired (for the scheduler). */
  async findTimedOutMatches(now: Date = new Date()): Promise<PoolMatch[]> {
    return this.matchRepo
      .createQueryBuilder('m')
      .where('m.status = :status', { status: 'active' })
      .andWhere('m.turnDeadline IS NOT NULL')
      .andWhere('m.turnDeadline < :now', { now })
      .getMany();
  }

  // ── Broadcast ───────────────────────────────────────────────────────────────

  buildView(m: PoolMatch) {
    return {
      id: m.id,
      mode: m.mode,
      status: m.status,
      seatAUserId: m.seatAUserId,
      seatBUserId: m.seatBUserId,
      stakeMinor: m.stakeMinor,
      turn: m.turn,
      groups: { A: m.groupA, B: m.groupB },
      tableOpen: m.tableOpen,
      ballInHand: m.ballInHand,
      phase: m.phase,
      winnerSeat: m.winnerSeat,
      board: m.board,
      shotCount: m.shotCount,
      turnDeadline: m.turnDeadline,
      tournamentId: m.tournamentId,
    };
  }

  private broadcastMatch(m: PoolMatch): void {
    try {
      this.gateway.emitPoolMatchUpdated(m.id, this.buildView(m));
    } catch (e) {
      this.logger.debug(`match broadcast skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  private broadcastShot(matchId: string, seat: Seat, input: ShotInput, outcome: ShotOutcome): void {
    try {
      this.gateway.emitPoolShotResolved(matchId, {
        matchId,
        seat,
        input,
        pocketed: outcome.pocketed,
        fouls: outcome.fouls,
        reason: outcome.reason,
        turnPassed: outcome.turnPassed,
        gameOver: outcome.gameOver,
        winnerSeat: outcome.winner,
        board: outcome.state.balls,
        turn: outcome.state.turn,
      });
    } catch (e) {
      this.logger.debug(`shot broadcast skipped: ${e instanceof Error ? e.message : e}`);
    }
  }
}

function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062;
}
