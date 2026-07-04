import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
} from 'typeorm';
import { BingoRoom } from './bingo-room.entity';
import { BingoGrid } from './bingo-ticket.entity';
import { TenantOwnedEntity } from '../../common/tenant/tenant-owned.entity';

/**
 * A single pre-generated 75-ball Bingo card in a room's fixed card pool.
 *
 * The entire pool is generated once, atomically, when the room is created —
 * before any ticket sales. Cards are unique within a room (enforced both by the
 * in-memory dedup during generation and the UNIQUE(roomId, cardHash) index).
 *
 * A player never generates a card at purchase time: they pick a cartelaNumber
 * and the matching unassigned card is bound to their ticket (assignedTicketId).
 * Only prefilled/derash rooms have a pool; line/pattern rooms do not use this.
 */
@Entity({ name: 'bingo_cards', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
@Index('UQ_bingo_card_room_cartela', ['roomId', 'cartelaNumber'], { unique: true })
@Index('UQ_bingo_card_room_hash', ['roomId', 'cardHash'], { unique: true })
@Index('IX_bingo_card_room_assigned', ['roomId', 'assignedTicketId'])
export class BingoCard extends TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  roomId: string;

  @ManyToOne(() => BingoRoom, { onDelete: 'CASCADE' })
  room: BingoRoom;

  /** The cartela label the player picks from the grid (1..gridSize). */
  @Column({ type: 'int' })
  cartelaNumber: number;

  /** The pre-generated 5×5 card (center cell is null = FREE space). */
  @Column({ type: 'json' })
  grid: BingoGrid;

  /** Canonical, order-stable hash of the card used to guarantee uniqueness. */
  @Column({ type: 'varchar', length: 128 })
  cardHash: string;

  /** Ticket this card was assigned to, or NULL while it is still available. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  assignedTicketId?: string | null;

  /** User who was assigned this card (mirrors the owning ticket). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  assignedUserId?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
