import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { BingoRoom, BingoPrizeTier } from './bingo-room.entity';

export type BingoTicketStatus = 'active' | 'won' | 'lost' | 'cancelled';
export type BingoSettlementStatus = 'pending' | 'settled';
export type BingoGrid = Array<Array<number | null>>;

const bigintTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => value ? Number(value) : 0
};

@Entity('bingo_tickets')
@Index(['userId', 'createdAt'])
@Index(['roomId', 'userId', 'purchaseIdempotencyKey'])
@Index(['roomId', 'settlementStatus'])
export class BingoTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar', length: 36 })
  @Index()
  roomId: string;

  @ManyToOne(() => BingoRoom, { onDelete: 'RESTRICT' })
  room: BingoRoom;

  @Column({ type: 'json' })
  grid: BingoGrid;

  @Column({ type: 'json' })
  markedNumbers: number[];

  @Column({ type: 'json' })
  completedLines: number[];

  @Column({ type: 'json' })
  wonTiers: BingoPrizeTier[];

  @Column({ type: 'int' })
  stakeMinor: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  payoutMinor: number;

  @Column({
    type: 'enum',
    enum: ['active', 'won', 'lost', 'cancelled'],
    default: 'active',
  })
  @Index()
  status: BingoTicketStatus;

  @Column({
    type: 'enum',
    enum: ['pending', 'settled'],
    default: 'pending',
  })
  @Index()
  settlementStatus: BingoSettlementStatus;

  @Column({ type: 'varchar', length: 255 })
  purchaseIdempotencyKey: string;

  @Column({ type: 'json', nullable: true })
  walletDebit?: Record<string, unknown>;

  @Column({ type: 'json' })
  walletCredits: Array<Record<string, unknown>>;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
