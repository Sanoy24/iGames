import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type BingoRoomStatus = 'open' | 'running' | 'completed' | 'cancelled';
export type BingoPrizeTier = 'one_line' | 'two_lines' | 'full_house';
export type BingoWinMode = 'line' | 'pattern';

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

@Entity('bingo_rooms')
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

  @Column({ type: 'timestamp' })
  @Index()
  scheduledStartAt: Date;

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

  /** 'line' = 90-ball 3×9 with one/two/full_house tiers. 'pattern' = 5×5 pattern card. */
  @Column({ type: 'varchar', length: 10, default: 'line' })
  winMode: BingoWinMode;

  /** Number pool size for this room (90 for line mode, configurable for pattern mode). */
  @Column({ type: 'int', default: 90 })
  numberRange: number;

  /** Active patterns and their prizes — only relevant when winMode === 'pattern'. */
  @Column({ type: 'json', default: '[]' })
  patternPrizes: BingoPatternPrize[];

  /** House edge % at time of room creation — winner receives (100 - houseEdgePct)% of pot. */
  @Column({ type: 'int', default: 20 })
  houseEdgePct: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
