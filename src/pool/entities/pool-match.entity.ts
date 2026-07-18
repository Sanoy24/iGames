import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Ball } from '../engine/types';
import { Group, Seat, GamePhase } from '../rules/rules-types';
import { PoolMode } from '../pool.service';

export type PoolMatchStatus = 'active' | 'completed' | 'aborted';

/**
 * One 8-ball game between two seats. The board and turn/group state are stored
 * so the server stays authoritative between shots; `rackSeed` + the ordered
 * pool_shots rows let the whole game be replayed and verified.
 */
@Entity({ name: 'pool_matches', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['status', 'createdAt'])
export class PoolMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  mode: PoolMode;

  @Column({ type: 'enum', enum: ['active', 'completed', 'aborted'], default: 'active' })
  @Index()
  status: PoolMatchStatus;

  /** Internal user ids for each seat. Seat B may be null for a bot (single player). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  seatAUserId: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  seatBUserId: string | null;

  /** Per-seat stake in minor units (escrow handled by a later step). */
  @Column({ type: 'int', default: 0 })
  stakeMinor: number;

  // ── Deterministic replay material ──
  @Column({ type: 'int' })
  rackSeed: number;

  /** Hash of the randomness material that produced the seed (audit trail). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  seedHash: string | null;

  @Column({ type: 'int', default: 1 })
  engineVersion: number;

  @Column({ type: 'int', default: 1 })
  rulesetVersion: number;

  @Column({ type: 'varchar', length: 1 })
  breakerSeat: Seat;

  // ── Live game state ──
  @Column({ type: 'varchar', length: 1 })
  turn: Seat;

  @Column({ type: 'varchar', length: 8, nullable: true })
  groupA: Group | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  groupB: Group | null;

  @Column({ type: 'boolean', default: true })
  tableOpen: boolean;

  @Column({ type: 'boolean', default: false })
  ballInHand: boolean;

  @Column({ type: 'varchar', length: 12, default: 'break' })
  phase: GamePhase;

  @Column({ type: 'varchar', length: 1, nullable: true })
  winnerSeat: Seat | null;

  /** Current authoritative board (positions + pocketed flags). */
  @Column({ type: 'json' })
  board: Ball[];

  @Column({ type: 'int', default: 0 })
  shotCount: number;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
