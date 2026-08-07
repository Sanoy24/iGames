import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
    ManyToOne,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type AgentSettlementStatus =
    | 'pending'
    | 'approved'
    | 'paid'
    | 'rejected';
export type AgentSettlementPaymentMethod =
    | 'bank_transfer'
    | 'cash'
    | 'mobile_money'
    | 'bank_branch'
    | 'other';

const bigintTransformer = {
    to: (value: number | null) => value,
    from: (value: string | null) => (value ? Number(value) : 0),
};

/**
 * A real-world payout to an agent, covering their earnings for [periodStart,
 * periodEnd)  deliberately separate from the earnings themselves (see
 * AgentsService.computeAgentEarnings). Earnings represent what the agent has
 * earned; a settlement represents what has actually been paid to them.
 * Named `agent_settlements` to avoid any confusion with Bingo/Keno's unrelated
 * *round*-settlement terminology.
 */
@Entity({ name: 'agent_settlements', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['agentId', 'createdAt'])
export class AgentSettlement {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 36 })
    @Index()
    agentId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    agent: User;

    @Column({ type: 'timestamp' })
    periodStart: Date;

    @Column({ type: 'timestamp' })
    periodEnd: Date;

    /** Snapshotted from computeAgentEarnings for [periodStart, periodEnd) at creation time. */
    @Column({ type: 'bigint', transformer: bigintTransformer })
    gameCommissionMinor: number;

    @Column({ type: 'bigint', transformer: bigintTransformer })
    withdrawalFeesMinor: number;

    /** = gameCommissionMinor + withdrawalFeesMinor, for the period. */
    @Column({ type: 'bigint', transformer: bigintTransformer })
    totalEarnedMinor: number;

    /** What's actually being paid in THIS settlement  admin-entered, may be a partial payment. */
    @Column({ type: 'bigint', transformer: bigintTransformer })
    amountPaidMinor: number;

    /** Snapshot: lifetime-earned-to-periodEnd minus lifetime-paid-to-date, INCLUDING this settlement. */
    @Column({ type: 'bigint', transformer: bigintTransformer })
    outstandingBalanceMinor: number;

    @Column({
        type: 'enum',
        enum: ['pending', 'approved', 'paid', 'rejected'],
        default: 'pending',
    })
    @Index()
    status: AgentSettlementStatus;

    @Column({ type: 'varchar', length: 20, nullable: true })
    paymentMethod?: AgentSettlementPaymentMethod | null;

    @Column({ type: 'varchar', length: 255, nullable: true })
    ftNumber?: string | null;

    /** Admin-uploaded photo/PDF of the payment receipt, relative to /uploads/. */
    @Column({ type: 'varchar', length: 500, nullable: true })
    receiptFileUrl?: string | null;

    @Column({ type: 'timestamp', nullable: true })
    paidAt?: Date | null;

    @Column({ type: 'varchar', length: 36, nullable: true })
    paidByAdminId?: string | null;

    @Column({ type: 'varchar', length: 1000, nullable: true })
    notes?: string | null;

    /** True when the agent submitted this via the self-service "Request Settlement"
     * button (as opposed to an admin creating it directly). Used to scope the
     * cooldown to the agent's own request cadence, not admin activity. */
    @Column({ type: 'boolean', default: false })
    requestedByAgent: boolean;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
