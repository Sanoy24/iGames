import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity';

@Entity({ name: 'admin_audit_logs', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class AdminAuditLog extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  adminUserId: string;

  @Column({ type: 'varchar', length: 10 })
  method: string;

  @Column({ type: 'varchar', length: 255 })
  url: string;

  @Column({ type: 'json' })
  body: any;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
