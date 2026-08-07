import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

/**
 * Admin-configured flat withdrawal fee tier. The fee for a withdrawal is the
 * `feeMinor` of whichever ACTIVE range covers the amount (`minAmountMinor` ≤
 * amount ≤ `maxAmountMinor`, or amount ≥ `minAmountMinor` when `maxAmountMinor`
 * is null  the open-ended top tier). Active ranges must never overlap (enforced
 * in AdminService on create/update); resolution/overlap helpers live in
 * `withdrawal-fee-range.util.ts`. The processing agent keeps 100% of the fee
 * there is no platform split.
 */
@Entity({ name: 'withdrawal_fee_ranges', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class WithdrawalFeeRange {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'int' })
    @Index()
    minAmountMinor: number;

    /** Null = open-ended ("and above"). */
    @Column({ type: 'int', nullable: true })
    maxAmountMinor: number | null;

    @Column({ type: 'int' })
    feeMinor: number;

    @Column({ type: 'boolean', default: true })
    @Index()
    active: boolean;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
