import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * DB-visible trail of failures inside commission settlement (e.g.
 * BingoService.settleReferralCommission)  that function runs from the
 * scheduler with all errors caught-and-logged (never thrown, so a failure
 * never blocks the room-completion pipeline), which normally means a failure
 * is only visible in server logs. This table exists so an admin without log
 * access can query `SELECT * FROM commission_settlement_errors ORDER BY
 * createdAt DESC` directly to see what actually happened.
 */
@Entity({
    name: 'commission_settlement_errors',
    engine: 'InnoDB ROW_FORMAT=DYNAMIC',
})
export class CommissionSettlementError {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 36 })
    @Index()
    roomId: string;

    /** Which function raised this, e.g. 'settleReferralCommission'. */
    @Column({ type: 'varchar', length: 64 })
    source: string;

    @Column({ type: 'text' })
    message: string;

    @Column({ type: 'text', nullable: true })
    stack?: string | null;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;
}
