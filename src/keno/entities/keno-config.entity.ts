import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type KenoConfigStatus = 'active' | 'inactive';

export class KenoPaytableEntry {
  spots: number;
  matches: number;
  payoutMultiplier: number;
}

@Entity('keno_configs')
export class KenoConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'int', unique: true })
  version: number;

  @Column({ type: 'enum', enum: ['active', 'inactive'], default: 'inactive' })
  @Index()
  status: KenoConfigStatus;

  @Column({ type: 'int', default: 1 })
  numberMin: number;

  @Column({ type: 'int', default: 80 })
  numberMax: number;

  @Column({ type: 'int', default: 20 })
  drawSize: number;

  @Column({ type: 'json' })
  allowedSpots: number[];

  @Column({ type: 'int' })
  ticketPriceMinor: number;

  @Column({ type: 'json' })
  paytable: KenoPaytableEntry[];

  @Column({ type: 'int', default: 0 })
  globalBotWinInterval: number;

  @Column({ type: 'int', default: 3 })
  autoScheduleIntervalMinutes: number;

  @Column({ type: 'int', default: 40 })
  autoScheduleIntervalSeconds: number;

  @Column({ type: 'int', default: 0 })
  maxWinnersPerDraw: number;

  @Column({ type: 'int', default: 100 })
  winChancePct: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
