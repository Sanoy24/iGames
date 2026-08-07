import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import {
    BingoPatternPrize,
    BingoPrizeConfig,
    BingoWinMode,
} from './bingo-room.entity';

/**
 * An admin-defined PERSISTENT custom room (see BingoService.ensureCustomRoomSlots).
 * Unlike a one-off room created via BingoService.createRoom (isAdminCreated: true,
 * never recreated), a room spawned from a slot keeps recreating itself with the
 * same name/price/prizes/style after every round  the House/Agent Room Slot
 * mechanism, generalized to any number of independently-named custom rooms.
 */
@Entity({
    name: 'bingo_custom_room_slots',
    engine: 'InnoDB ROW_FORMAT=DYNAMIC',
})
export class BingoCustomRoomSlot {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ type: 'int' })
    ticketPriceMinor: number;

    @Column({ type: 'int' })
    maxTickets: number;

    @Column({ type: 'varchar', length: 10, default: 'prefilled' })
    winMode: BingoWinMode;

    @Column({ type: 'int', nullable: true })
    numberRange?: number | null;

    @Column({ type: 'int', nullable: true })
    gridSize?: number | null;

    @Column({ type: 'json' })
    prizes: BingoPrizeConfig;

    @Column({ type: 'json', default: '[]' })
    patternPrizes: BingoPatternPrize[];

    /** Lobby card gradient  null = pick one at random each recreation. */
    @Column({ type: 'varchar', length: 20, nullable: true })
    cardPaletteId?: string | null;

    /** Decorative ball number  null = pick one at random each recreation. */
    @Column({ type: 'int', nullable: true })
    cardBallNumber?: number | null;

    /**
     * Whether this slot should keep auto-recreating its room. Set false to pause
     * (its current live room finishes normally and is not replaced) without
     * losing the slot's saved settings.
     */
    @Column({ type: 'boolean', default: true })
    isActive: boolean;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
