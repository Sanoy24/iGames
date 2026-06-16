import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type BingoRoomStatus = 'open' | 'running' | 'completed' | 'cancelled';
export type BingoPrizeTier = 'one_line' | 'two_lines' | 'full_house';

export class BingoPrizeConfig {
  oneLineMinor: number;
  twoLinesMinor: number;
  fullHouseMinor: number;
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
  settledTiers: BingoPrizeTier[];

  @Column({ type: 'json' })
  winnersByTier: Record<string, string[]>;

  @Column({ type: 'json', nullable: true })
  settlementSummary?: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
