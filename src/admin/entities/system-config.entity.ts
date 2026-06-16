import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('system_configs')
export class SystemConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true, default: 'global' })
  key: string;

  @Column({ type: 'int', default: 100 })
  telebirrCreditMinorPerBirr: number;

  @Column({ type: 'int', default: 0 })
  welcomeBonusMinor: number;

  @Column({ type: 'int', default: 0 })
  withdrawalServiceChargePct: number;

  @Column({ type: 'int', default: 0 })
  withdrawalMinAmountMinor: number;

  @Column({ type: 'int', default: 0 })
  withdrawalMaxAmountMinor: number;

  @Column({ type: 'int', default: 1 })
  maxPendingWithdrawalsPerUser: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
