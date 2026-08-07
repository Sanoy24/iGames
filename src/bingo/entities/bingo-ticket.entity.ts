import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
    ManyToOne,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { BingoRoom, BingoPrizeTier } from './bingo-room.entity';

export type BingoTicketStatus =
    | 'active'
    | 'won'
    | 'lost'
    | 'cancelled'
    | 'disqualified';
export type BingoSettlementStatus = 'pending' | 'settled';
export type BingoGrid = Array<Array<number | null>>;

const bigintTransformer = {
    to: (value: number | null) => value,
    from: (value: string | null) => (value ? Number(value) : 0),
};

@Entity({ name: 'bingo_tickets', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
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

    /**
     * Prefilled/derash mode: the cartela number the player picked from the grid
     * (1..gridSize). Null for line/pattern tickets. The mapped card lives in `grid`.
     */
    @Column({ type: 'int', nullable: true })
    cartelaNumber?: number | null;

    /**
     * Prefilled/derash mode: the pre-generated pool card assigned to this ticket.
     * `grid` above holds an immutable snapshot of that card at assignment time, so
     * settlement/winner logic keeps reading `grid` unchanged. Null for line/pattern.
     */
    @Column({ type: 'varchar', length: 36, nullable: true })
    cardId?: string | null;

    @Column({ type: 'json' })
    markedNumbers: number[];

    @Column({ type: 'json' })
    completedLines: number[];

    @Column({ type: 'json' })
    wonTiers: BingoPrizeTier[];

    /** Pattern IDs completed by this ticket (pattern mode only). */
    @Column({ type: 'json', default: '[]' })
    completedPatterns: string[];

    @Column({ type: 'int' })
    stakeMinor: number;

    @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
    payoutMinor: number;

    @Column({
        type: 'enum',
        enum: ['active', 'won', 'lost', 'cancelled', 'disqualified'],
        default: 'active',
    })
    @Index()
    status: BingoTicketStatus;

    /**
     * Derash/prefilled manual-claim support. When true (default) the settlement
     * tick auto-awards this card the moment it completes a place's pattern  the
     * historical behaviour. When the owner turns "Auto" OFF in the calling page we
     * set this false on all their active cards in the room, so the tick SKIPS them
     * and they can only win by tapping "Bingo" (racing the tick and other players).
     */
    @Column({ type: 'boolean', default: true })
    autoClaim: boolean;

    @Column({
        type: 'enum',
        enum: ['pending', 'settled'],
        default: 'pending',
    })
    @Index()
    settlementStatus: BingoSettlementStatus;

    /**
     * Why this card was disqualified (manual mode). Currently 'premature_claim'
     * the player tapped BINGO before the card actually completed a winning pattern.
     * NULL for cards that were never disqualified.
     */
    @Column({ type: 'varchar', length: 40, nullable: true })
    disqualifiedReason?: string | null;

    /** When the card was disqualified. NULL if never disqualified. */
    @Column({ type: 'timestamp', nullable: true })
    disqualifiedAt?: Date | null;

    /**
     * Audit flag: this DISQUALIFIED card went on to be the round's winning card
     * its pattern completed first for an open place  but because it was
     * disqualified the prize went to the HOUSE, not the player. Kept so support can
     * answer "why wasn't I paid?": the card won, but the earlier false call voided it.
     */
    @Column({ type: 'boolean', default: false })
    disqualifiedWonRound: boolean;

    /** Total prize (minor units) this disqualified card forfeited to the house. */
    @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
    forfeitedWinMinor: number;

    /** Place keys (e.g. ['1st']) this disqualified card would have won. NULL/[] otherwise. */
    @Column({ type: 'json', nullable: true })
    forfeitedPlaces?: string[] | null;

    /**
     * Owning agent (user id) of the room this ticket was bought in  snapshotted at
     * purchase (Approach B). NULL = house room / attribution off. Drives per-agent
     * settlement and performance stats without a room join.
     */
    @Column({ type: 'varchar', length: 36, nullable: true })
    @Index()
    agentId?: string | null;

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
