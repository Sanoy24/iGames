import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity';

@Entity({ name: 'agent_shifts', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['agentId', 'isActive'])
export class AgentShift extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  agentId: string;

  @ManyToOne(() => User, (user) => user.shifts, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'int' })
  startHour: number;

  @Column({ type: 'int' })
  startMinute: number;

  @Column({ type: 'int' })
  endHour: number;

  @Column({ type: 'int' })
  endMinute: number;

  @Column({ type: 'json' })
  daysOfWeek: number[];

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  label?: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
