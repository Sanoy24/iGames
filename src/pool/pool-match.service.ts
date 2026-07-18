import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RngService } from '../rng/rng.service';
import { PoolMatch } from './entities/pool-match.entity';
import { PoolShot } from './entities/pool-shot.entity';
import { PoolMode, PoolService } from './pool.service';
import { standardTable } from './engine/table';
import { runShot } from './engine/simulator';
import { ShotInput } from './engine/types';
import { GameState, Seat, ShotOutcome } from './rules/rules-types';
import { newGame, otherSeat, resolveShot } from './rules/rules';

export interface CreateMatchInput {
  mode: PoolMode;
  seatAUserId: string | null;
  seatBUserId: string | null;
  stakeMinor?: number;
  /** Which seat breaks. Defaults to A. */
  breaker?: Seat;
}

@Injectable()
export class PoolMatchService {
  private readonly logger = new Logger(PoolMatchService.name);
  // Physics geometry is fixed for now; moving felt/cue tuning into DB config is
  // a later step (see project notes).
  private readonly table = standardTable();

  constructor(
    @InjectRepository(PoolMatch)
    private readonly matchRepo: Repository<PoolMatch>,
    @InjectRepository(PoolShot)
    private readonly shotRepo: Repository<PoolShot>,
    private readonly dataSource: DataSource,
    private readonly rngService: RngService,
    private readonly poolService: PoolService,
  ) {}

  /** Create and rack a new match. Seat B may be null (bot / single player). */
  async createMatch(input: CreateMatchInput): Promise<PoolMatch> {
    const cfg = await this.poolService.getConfig();
    const breaker: Seat = input.breaker ?? 'A';

    // Rack seed via the crypto RNG service (never Math.random). Stored on the
    // match so the game is deterministically replayable.
    const draw = await this.rngService.drawUniqueNumbers({ min: 1, max: 2_000_000_000, count: 1 });
    const seed = draw.numbers[0];

    const state = newGame(this.table, seed, breaker);
    const match = this.matchRepo.create({
      mode: input.mode,
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
    });
    return this.matchRepo.save(match);
  }

  async getMatch(id: string): Promise<PoolMatch> {
    const match = await this.matchRepo.findOneBy({ id });
    if (!match) throw new NotFoundException('Match not found');
    return match;
  }

  async getShots(matchId: string): Promise<PoolShot[]> {
    return this.shotRepo.find({ where: { matchId }, order: { shotIndex: 'ASC' } });
  }

  /** Reconstruct the rules-engine game state from a persisted match row. */
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

  /** Which seat this user occupies, or throw if they aren't in the match. */
  private seatOf(match: PoolMatch, userId: string): Seat {
    if (match.seatAUserId === userId) return 'A';
    if (match.seatBUserId === userId) return 'B';
    throw new ForbiddenException('You are not a player in this match');
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
      const R = this.table.ballRadius;
      const { x, y } = input.cuePos;
      if (!finite(x) || !finite(y) || x < R || x > this.table.width - R || y < R || y > this.table.height - R) {
        throw new BadRequestException('Cue placement is outside the table');
      }
      const clash = match.board.some(
        (b) => b.number !== 0 && !b.pocketed && Math.hypot(b.pos.x - x, b.pos.y - y) < 2 * R,
      );
      if (clash) throw new BadRequestException('Cue placement overlaps another ball');
    }
  }

  /**
   * Server-authoritative shot: validate the shooter and inputs, run the shot
   * through the deterministic engine, apply the 8-ball rules, and persist the
   * new board + append the shot log — all in one transaction. The unique
   * (matchId, shotIndex) index makes a duplicate submission a no-op error rather
   * than a double-apply.
   */
  async submitShot(matchId: string, userId: string, input: ShotInput): Promise<ShotOutcome> {
    const match = await this.getMatch(matchId);
    if (match.status !== 'active') {
      throw new ConflictException('Match is not active');
    }
    const seat = this.seatOf(match, userId);
    if (seat !== match.turn) {
      throw new ConflictException('It is not your turn');
    }
    this.validateInput(match, input);

    const pre = this.toState(match);
    const result = runShot(pre.balls, input, this.table);
    const outcome = resolveShot(pre, result, this.table);
    const shotIndex = match.shotCount;

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
          boardAfter: outcome.state.balls,
        });

        const s = outcome.state;
        await manager.getRepository(PoolMatch).update(
          { id: match.id, shotCount: shotIndex }, // optimistic guard on shotCount
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
          },
        );
      });
    } catch (err) {
      // Unique-index violation on (matchId, shotIndex) ⇒ a concurrent/duplicate
      // submission already applied this shot.
      if (isDuplicateKey(err)) {
        throw new ConflictException('Shot already applied');
      }
      throw err;
    }

    return outcome;
  }
}

function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062;
}
