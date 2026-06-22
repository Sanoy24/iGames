import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Single-row global config for Bingo automation.
 * Always read/written via BingoService.getBingoConfig().
 */
@Entity('bingo_config')
export class BingoConfig {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  key: string; // always 'global'

  /** Master switch. When false the scheduler will not create new rooms. */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /**
   * Minutes after a room completes before the next one starts.
   * 0 = create the next room immediately on completion.
   */
  @Column({ type: 'int', default: 0 })
  autoRepeatIntervalMinutes: number;

  @Column({ type: 'int', default: 500 })
  defaultTicketPriceMinor: number;

  @Column({ type: 'int', default: 200 })
  defaultMaxTickets: number;

  @Column({ type: 'int', default: 20000 })
  defaultOneLineMinor: number;

  @Column({ type: 'int', default: 50000 })
  defaultTwoLinesMinor: number;

  @Column({ type: 'int', default: 100000 })
  defaultFullHouseMinor: number;

  /** How many seconds between each number draw (default 5). */
  @Column({ type: 'int', default: 5 })
  drawIntervalSeconds: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
