import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ShotInput } from '../engine/types';
import { PoolFoul, Seat } from '../rules/rules-types';

/**
 * Append-only log of every shot in a match — the replay/audit record. The unique
 * (matchId, shotIndex) index makes shot application idempotent: a duplicate
 * submission for an already-recorded index cannot double-apply.
 */
@Entity({ name: 'pool_shots', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['matchId', 'shotIndex'], { unique: true })
export class PoolShot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  matchId: string;

  /** Zero-based order of this shot within the match. */
  @Column({ type: 'int' })
  shotIndex: number;

  @Column({ type: 'varchar', length: 1 })
  seat: Seat;

  /** The exact inputs the shooter sent — replaying these reproduces the shot. */
  @Column({ type: 'json' })
  input: ShotInput;

  @Column({ type: 'json' })
  pocketed: number[];

  @Column({ type: 'json' })
  fouls: PoolFoul[];

  @Column({ type: 'boolean', default: false })
  turnPassed: boolean;

  @Column({ type: 'boolean', default: false })
  assignedGroups: boolean;

  @Column({ type: 'boolean', default: false })
  gameOver: boolean;

  @Column({ type: 'varchar', length: 1, nullable: true })
  winnerSeat: Seat | null;

  @Column({ type: 'varchar', length: 200 })
  reason: string;

  /** Board snapshot after this shot (for scrub/verify without re-simulating). */
  @Column({ type: 'json' })
  boardAfter: unknown;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
