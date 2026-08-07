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
import { PoolPhysicsSnapshot } from '../pool-physics';

export type PoolMatchStatus = 'active' | 'completed' | 'aborted';

/**
 * One 8-ball game between two seats. The board and turn/group state are stored
 * so the server stays authoritative between shots; `rackSeed` + the ordered
 * pool_shots rows let the whole game be replayed and verified.
 */
@Entity({ name: 'pool_matches', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['status', 'createdAt'])
// One match per bracket slot. Casual matches have all three columns NULL, which
// MySQL permits to repeat, so only tournament matches are constrained.
@Index(['tournamentId', 'tournamentRound', 'tournamentSlot'], { unique: true })
export class PoolMatch {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 16 })
    mode: PoolMode;

    @Column({
        type: 'enum',
        enum: ['active', 'completed', 'aborted'],
        default: 'active',
    })
    @Index()
    status: PoolMatchStatus;

    /** Internal user ids for each seat. Seat B may be null for a bot (single player). */
    @Column({ type: 'varchar', length: 36, nullable: true })
    seatAUserId: string | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    seatBUserId: string | null;

    /**
     * Display (Telegram) names captured at creation so the client can show the real
     * opponent's name  not a generic "Opponent"  without a per-view user lookup.
     * Null for a bot seat (the client renders "AI") or legacy rows.
     */
    @Column({ type: 'varchar', length: 120, nullable: true })
    seatAName: string | null;

    @Column({ type: 'varchar', length: 120, nullable: true })
    seatBName: string | null;

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

    /**
     * Physics tuning captured at creation. Every shot and every replay of this
     * match uses this snapshot, so later admin config edits can't alter an
     * in-flight game or break a finished game's deterministic replay. Null on
     * legacy rows → engine defaults.
     */
    @Column({ type: 'json', nullable: true })
    physics: PoolPhysicsSnapshot | null;

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

    /**
     * Consecutive shot-clock timeouts per seat, reset to 0 when that seat takes a
     * real shot. A timeout is a foul (turn passes, opponent gets ball in hand);
     * only once a seat reaches `maxTimeoutFouls` does it forfeit the match. This
     * prevents one accidental clock overrun from losing a whole staked game while
     * still ending games abandoned by a disconnected player.
     */
    @Column({ type: 'int', default: 0 })
    timeoutsA: number;

    @Column({ type: 'int', default: 0 })
    timeoutsB: number;

    /** When the current player's shot clock expires (null = untimed). */
    @Column({ type: 'timestamp', nullable: true })
    @Index()
    turnDeadline: Date | null;

    /** Set once winnings/refunds have been settled (idempotency guard). */
    @Column({ type: 'timestamp', nullable: true })
    settledAt: Date | null;

    // ── Tournament linkage (null for casual matches) ──
    @Column({ type: 'varchar', length: 36, nullable: true })
    @Index()
    tournamentId: string | null;

    @Column({ type: 'int', nullable: true })
    tournamentRound: number | null;

    /** Slot index within the round; the winner feeds slot ⌊slot/2⌋ of the next round. */
    @Column({ type: 'int', nullable: true })
    tournamentSlot: number | null;

    @Column({ type: 'timestamp', nullable: true })
    completedAt: Date | null;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
