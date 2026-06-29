import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('crash_config')
export class CrashConfig {
  @PrimaryColumn({ type: 'varchar', length: 64, default: 'default' })
  key: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'int', default: 3 })
  houseEdgePct: number;

  @Column({ type: 'int', default: 100 })
  minBetMinor: number;

  @Column({ type: 'int', default: 500_000 })
  maxBetMinor: number;

  @Column({ type: 'int', default: 12 })
  waitingDurationSeconds: number;

  @Column({ type: 'int', default: 100 })
  tickIntervalMs: number;

  @Column({ type: 'int', default: 10000 })
  maxMultiplierX100: number;

  @Column({ type: 'int', default: 500 })
  botBetMinor: number;

  @Column({ type: 'int', default: 0 })
  globalBotWinInterval: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
