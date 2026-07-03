import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'crash_config', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class CrashConfig {
  @PrimaryColumn({ type: 'varchar', length: 64, default: 'default' })
  key: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'int', default: 3 })
  houseEdgePct: number;

  // Flat 1:1 model — bet amounts are whole ETB (1 unit = 1 Birr), not cents.
  @Column({ type: 'int', default: 1 })
  minBetMinor: number;

  @Column({ type: 'int', default: 5_000 })
  maxBetMinor: number;

  @Column({ type: 'int', default: 12 })
  waitingDurationSeconds: number;

  @Column({ type: 'int', default: 100 })
  tickIntervalMs: number;

  @Column({ type: 'int', default: 10000 })
  maxMultiplierX100: number;

  @Column({ type: 'int', default: 5 })
  botBetMinor: number;

  @Column({ type: 'int', default: 0 })
  globalBotWinInterval: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
