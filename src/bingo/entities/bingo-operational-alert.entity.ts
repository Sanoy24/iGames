import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';

export type BingoOperationalAlertKind =
    | 'pattern_resolution_failed'
    | 'redis_lock_unavailable'
    /**
     * Bots were allowed to open a room's buy-window countdown, with the exact
     * condition that permitted it. Recorded because "why did bots buy before the
     * player arrived?" was, for several rounds, answerable only by grepping a log
     * file whose first 40KB are boot noise - which is the precise situation this
     * table exists to avoid.
     */
    | 'bot_buy_gate_opened';

/**
 * DB-visible trail of operational failures in the Bingo draw/settlement path
 * that would otherwise only show up in server logs  same purpose as
 * CommissionSettlementError, generalized with a `kind` discriminator so more
 * failure classes can share this one table instead of each growing their own.
 * An admin without log access can query this (or the `/admin/bingo/alerts`
 * endpoint) to see what actually happened without needing a screen recording.
 */
@Entity({
    name: 'bingo_operational_alerts',
    engine: 'InnoDB ROW_FORMAT=DYNAMIC',
})
export class BingoOperationalAlert {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 64 })
    @Index()
    kind: BingoOperationalAlertKind;

    /** Null when the failure is config-level (not tied to one specific room). */
    @Column({ type: 'varchar', length: 36, nullable: true })
    @Index()
    roomId?: string | null;

    @Column({ type: 'text' })
    message: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;
}
