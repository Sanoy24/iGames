import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'bingo_config', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class BingoConfig {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  key: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

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

  @Column({ type: 'int', default: 5 })
  drawIntervalSeconds: number;

  @Column({ type: 'varchar', length: 10, default: 'line' })
  defaultWinMode: string;

  @Column({ type: 'int', default: 75 })
  defaultNumberRange: number;

  /** Minimum balls drawn before any prize tier can be settled (0 = immediate). */
  @Column({ type: 'int', default: 0 })
  minDrawsBeforeWin: number;

  /** Minimum tickets sold before draw can start (0 = no minimum). */
  @Column({ type: 'int', default: 0 })
  minTicketsToStart: number;

  /** House edge percentage shown in admin UI for reference (0–100). */
  @Column({ type: 'int', default: 20 })
  houseEdgePct: number;

  /** Every N bingo rooms a randomly chosen active bot receives a guaranteed win. 0 = disabled. */
  @Column({ type: 'int', default: 0 })
  globalBingoBotWinInterval: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
