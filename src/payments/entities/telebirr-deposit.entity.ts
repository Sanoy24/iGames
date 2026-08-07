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

export type TelebirrDepositStatus = 'credited' | 'rejected';
export type DepositVerificationStatus = 'unverified' | 'verified' | 'flagged';

const bigintTransformer = {
    to: (value: number | null) => value,
    from: (value: string | null) => (value ? Number(value) : 0),
};

@Entity({ name: 'telebirr_deposits', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['userId', 'createdAt'])
export class TelebirrDeposit {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 36 })
    @Index()
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    user: User;

    @Column({ type: 'varchar', length: 36, nullable: true })
    @Index()
    agentId?: string;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    agent?: User;

    @Column({ type: 'varchar', length: 255, unique: true })
    receiptNo: string;

    /** Player-uploaded photo/PDF of the physical receipt, relative to /uploads/. */
    @Column({ type: 'varchar', length: 500, nullable: true })
    receiptFileUrl?: string | null;

    @Column({ type: 'bigint', transformer: bigintTransformer })
    amountMinor: number;

    @Column({ type: 'varchar', length: 10, default: 'CREDIT' })
    currencyCode: string;

    @Column({ type: 'enum', enum: ['credited', 'rejected'] })
    status: TelebirrDepositStatus;

    @Column({ type: 'varchar', length: 255, nullable: true })
    payerName?: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    payerPhone?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    creditedPartyName?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    creditedPartyAccount?: string;

    @Column({ type: 'varchar', length: 255, nullable: true })
    transactionStatus?: string;

    @Column({ type: 'json' })
    parsedReceipt: any;

    @Column({ type: 'json', nullable: true })
    verification?: Record<string, unknown>;

    @Column({ type: 'json', nullable: true })
    walletCredit?: Record<string, unknown>;

    /** Which wallet actually funded the player credit (only set when status is 'credited'). */
    @Column({
        type: 'enum',
        enum: ['agent_wallet', 'master_wallet'],
        nullable: true,
    })
    fundedBy?: 'agent_wallet' | 'master_wallet';

    /** Why it fell back to the Master Wallet instead of the agent's own wallet, if it did. */
    @Column({ type: 'varchar', length: 64, nullable: true })
    fundingFallbackReason?: string | null;

    /**
     * Admin sign-off, independent of `status`/crediting  this deposit is already
     * credited (or rejected) by the time an admin reviews it; verifying/flagging
     * here never blocks or reverses that. Purely a manual audit record.
     */
    @Column({
        type: 'enum',
        enum: ['unverified', 'verified', 'flagged'],
        default: 'unverified',
    })
    verificationStatus: DepositVerificationStatus;

    @Column({ type: 'varchar', length: 36, nullable: true })
    verifiedBy?: string | null;

    @Column({ type: 'timestamp', nullable: true })
    verifiedAt?: Date | null;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
