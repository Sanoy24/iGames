import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type BingoRoomStatus = 'open' | 'running' | 'completed' | 'cancelled';
export type BingoPrizeTier =
  | 'one_line'
  | 'two_lines'
  | 'full_house'
  | '1st'
  | '2nd'
  | '3rd'
  | '4th'
  | '5th';
export type BingoWinMode = 'line' | 'pattern' | 'prefilled';

export class BingoPrizeConfig {
  oneLineMinor: number;
  twoLinesMinor: number;
  fullHouseMinor: number;
}

export class BingoPatternPrize {
  patternId: string;
  name: string;
  prizeMinor: number;
}

@Entity({ name: 'bingo_rooms', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index(['status', 'scheduledStartAt'])
export class BingoRoom {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: ['open', 'running', 'completed', 'cancelled'],
    default: 'open',
  })
  @Index()
  status: BingoRoomStatus;

  @Column({ type: 'int' })
  ticketPriceMinor: number;

  @Column({ type: 'int' })
  maxTickets: number;

  @Column({ type: 'int', default: 0 })
  soldTickets: number;

  @Column({ type: 'json' })
  prizes: BingoPrizeConfig;

  /**
   * When the buy-window countdown ends and drawing begins. NULL means the room
   * is IDLE — created but not yet started. It is stamped (now + countdown) only
   * when the FIRST ticket is sold, so an unplayed room never draws or completes.
   */
  @Column({ type: 'timestamp', nullable: true })
  @Index()
  scheduledStartAt: Date | null;

  @Column({ type: 'json' })
  drawnNumbers: number[];

  @Column({ type: 'json' })
  rngAuditLogIds: string[];

  @Column({ type: 'json' })
  settledTiers: string[];

  @Column({ type: 'json' })
  winnersByTier: Record<string, string[]>;

  @Column({ type: 'json', nullable: true })
  settlementSummary?: Record<string, unknown>;

  /** 'line' = 90-ball 3×9, 'pattern' = 5×5 pattern card, 'prefilled' = numbered grid lottery. */
  @Column({ type: 'varchar', length: 10, default: 'prefilled' })
  winMode: BingoWinMode;

  /** Number pool size for this room (90 for line mode, configurable for pattern/prefilled mode). */
  @Column({ type: 'int', default: 90 })
  numberRange: number;

  /** Grid size for prefilled mode — total cartela cards available (e.g. 75). */
  @Column({ type: 'int', default: 75 })
  gridSize: number;

  /** Active patterns and their prizes — only relevant when winMode === 'pattern'. */
  @Column({ type: 'json', default: '[]' })
  patternPrizes: BingoPatternPrize[];

  /** House edge % at time of room creation — winner receives (100 - houseEdgePct)% of pot. */
  @Column({ type: 'int', default: 20 })
  houseEdgePct: number;

  /**
   * Derash place-decision mode, snapshotted from config at creation so a running
   * room keeps its behaviour even if the admin flips the config mid-game.
   * `race` = places locked first-come; `leaderboard` = ranks resolved at the end.
   */
  @Column({ type: 'varchar', length: 12, default: 'race' })
  rankingMode: 'race' | 'leaderboard';

  /**
   * DB-level "one active game at a time" guard. Set to 1 while the room is open
   * or running, and NULL once it completes or is cancelled. The UNIQUE index
   * lets MySQL hold at most one non-NULL row (multiple NULLs are allowed), so
   * two concurrent creators — even across separate backend instances or when
   * the Redis lock is unavailable — cannot both open an active room; the second
   * INSERT fails with a duplicate-key error.
   */
  @Column({ type: 'tinyint', nullable: true })
  @Index('UQ_bingo_active_game', { unique: true })
  activeGuard?: number | null;

  /**
   * Owning agent (user id) when per-agent rooms are enabled (Approach B). NULL =
   * house room. Settlement and performance stats are credited to this agent for
   * all games played in the room.
   */
  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  ownerAgentId?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  // Millisecond precision: findRunningRoomIdsDue() gates the next draw on
  // `updatedAt <= NOW() - INTERVAL drawIntervalSeconds SECOND`. A whole-second
  // TIMESTAMP truncates the commit time to the floor second, which alone was
  // worth up to ~1s of jitter in the gap between draws — read by players as
  // calls landing unevenly fast/slow. See ensureBingoRoomUpdatedAtPrecision()
  // in ensure-schema.ts for the one-off ALTER that upgrades an existing column.
  @UpdateDateColumn({ type: 'timestamp', precision: 3 })
  updatedAt: Date;
}
