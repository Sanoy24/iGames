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

  @Column({ type: 'int', default: 2 })
  drawIntervalSeconds: number;

  /** Seconds the buy/registration window stays open before a room starts drawing. */
  @Column({ type: 'int', default: 40 })
  salesWindowSeconds: number;

  /** Seconds the completed-room result is shown before advancing to the next room. */
  @Column({ type: 'int', default: 10 })
  resultDisplaySeconds: number;

  @Column({ type: 'varchar', length: 10, default: 'prefilled' })
  defaultWinMode: string;

  @Column({ type: 'int', default: 75 })
  defaultNumberRange: number;

  /** Number of cartela cards in the prefilled/derash grid (default 75, matching the ball pool). */
  @Column({ type: 'int', default: 75 })
  defaultGridSize: number;

  /** % of prize pool awarded to 1st place in prefilled mode. */
  @Column({ type: 'int', default: 80 })
  prefilledFirstPlacePct: number;

  /** Enable 2nd place prize in prefilled mode. */
  @Column({ type: 'boolean', default: false })
  prefilledSecondPlaceEnabled: boolean;

  /** % of prize pool awarded to 2nd place (only when enabled). */
  @Column({ type: 'int', default: 0 })
  prefilledSecondPlacePct: number;

  /** Enable 3rd place prize in prefilled mode. */
  @Column({ type: 'boolean', default: false })
  prefilledThirdPlaceEnabled: boolean;

  /** % of prize pool awarded to 3rd place (only when enabled). */
  @Column({ type: 'int', default: 0 })
  prefilledThirdPlacePct: number;

  /**
   * Winning pattern for prefilled/derash mode — the BingoPattern a cartela card
   * must complete to win a place. Null falls back to the built-in "Any Line".
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  prefilledWinPatternId?: string | null;

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
