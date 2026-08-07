import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from 'typeorm';

export type ConfigChangeType =
    | 'global_referral_commission'
    | 'agent_referral_commission'
    | 'withdrawal_fee_range';

/**
 * Before/after audit trail for financial configuration changes  distinct from
 * `AdminAuditLog`, which only records the raw HTTP method/url/body with no
 * semantic diff. Written explicitly at each mutation point (system config
 * update, agent update, withdrawal fee range CRUD) rather than via a generic
 * interceptor, since a real before/after value is needed, not the raw request.
 */
@Entity({ name: 'config_change_logs', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class ConfigChangeLog {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 64 })
    @Index()
    configType: ConfigChangeType;

    /** Agent userId for per-agent commission, or WithdrawalFeeRange id. Null for the global config row. */
    @Column({ type: 'varchar', length: 36, nullable: true })
    @Index()
    entityId: string | null;

    @Column({ type: 'text', nullable: true })
    previousValue: string | null;

    @Column({ type: 'text', nullable: true })
    newValue: string | null;

    @Column({ type: 'varchar', length: 36 })
    changedByAdminId: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;
}
