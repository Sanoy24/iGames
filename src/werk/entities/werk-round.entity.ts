import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';
import type { WerkWinningMode } from './werk-config.entity';

export type WerkRoundStatus =
    | 'lobby'
    | 'running'
    | 'settling'
    | 'completed'
    | 'cancelled';

/**
 * One shared Werk Flega round  the platform-wide unit of play. At most ONE round
 * is `lobby`/`running`/`settling` at a time (enforced by the `activeGuard` unique
 * index, exactly like BingoRoom). Multiple real players + house bots share the
 * same maze and coin pool. The maze/coins are fully determined by `seed` (drawn by
 * the RNG service, `seedAuditLogId` links the audit row) so the round is
 * reproducible from the audit trail.
 */
@Entity({ name: 'werk_rounds', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['status', 'scheduledStartAt'])
@Index(['createdAt'])
export class WerkRound {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({
        type: 'enum',
        enum: ['lobby', 'running', 'settling', 'completed', 'cancelled'],
        default: 'lobby',
    })
    @Index()
    status: WerkRoundStatus;

    // ── Round parameters (snapshotted from config at creation) ───────────────────
    @Column({ type: 'enum', enum: ['A', 'B'] })
    mode: WerkWinningMode;

    @Column({ type: 'int' })
    durationSec: number;

    @Column({ type: 'int', default: 15 })
    coinDensityX100: number;

    @Column({ type: 'int', default: 7 })
    finalSprintWarningSec: number;

    @Column({ type: 'boolean', default: true })
    powerupsEnabled: boolean;

    /** Max human seats a round accepts (config totalPlayers). */
    @Column({ type: 'int', default: 10 })
    maxPlayers: number;

    // ── RNG evidence ─────────────────────────────────────────────────────────────
    @Column({ type: 'bigint' })
    seed: number;

    @Column({ type: 'varchar', length: 36, nullable: true })
    seedAuditLogId: string | null;

    /** Server-generated bot roster (identity + behaviour) snapshotted at creation. */
    @Column({ type: 'json', nullable: true })
    botRoster: unknown[] | null;

    /**
     * Whether house bots actually play this round. Decided at start: false once the
     * real-player count reaches `botMaxRealPlayers` (bots stay out of busy rounds).
     */
    @Column({ type: 'boolean', default: true })
    botsEnabled: boolean;

    /**
     * When the lobby countdown ends and the round starts. NULL while idle (no one
     * has joined yet); stamped (now + countdown) when the FIRST player joins.
     */
    @Column({ type: 'timestamp', nullable: true })
    @Index()
    scheduledStartAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    startedAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    endedAt: Date | null;

    /** Snapshot of the final standings + win-control audit for evidence. */
    @Column({ type: 'json', nullable: true })
    resultJson: Record<string, unknown> | null;

    /**
     * DB-level "one active round at a time" guard. Set to 1 while lobby/running/
     * settling, NULL once completed/cancelled. The UNIQUE index lets MySQL hold at
     * most one non-NULL row, so two concurrent creators cannot both open a round.
     */
    @Column({ type: 'tinyint', nullable: true })
    @Index('UQ_werk_active_round', { unique: true })
    activeGuard?: number | null;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
