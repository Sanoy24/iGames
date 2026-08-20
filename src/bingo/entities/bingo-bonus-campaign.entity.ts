import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

export type BingoBonusScheduleType = 'once' | 'recurring';
export type BingoBonusRecurrenceFrequency = 'daily' | 'weekly';

export type BingoBonusRecurrence = {
    frequency: BingoBonusRecurrenceFrequency;
    /** 0 = Sunday … 6 = Saturday. Only used for weekly. */
    dayOfWeek?: number;
    /** Addis Ababa (UTC+3) local wall-clock time, HH:mm:ss. */
    startTime: string;
    /** Addis Ababa (UTC+3) local wall-clock time, HH:mm:ss. Must be after startTime (no overnight windows). */
    endTime: string;
};

/**
 * An admin-configured "Bonus Win" promo: while active, any ticket that completes
 * `patternId` in a prefilled/derash room (race mode) earns `prizeMinor` on top of
 * its normal Derash placement winnings  a wholly separate pot, evaluated once per
 * room (see BingoRoom.bonusSettlement) so it never re-pays on later draws of the
 * same room. Always interpreted in fixed Addis Ababa time (UTC+3, no DST), with
 * second-level precision on the window boundaries. Overlapping campaigns are
 * rejected at write time (see BingoService.assertNoBonusCampaignOverlap), so at
 * most one campaign is ever active at a given instant.
 */
@Entity({ name: 'bingo_bonus_campaigns', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class BingoBonusCampaign {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** Admin label, e.g. "Evening Bonus Hour". */
    @Column({ type: 'varchar', length: 100 })
    name: string;

    /** The BingoPattern that triggers this bonus when completed. */
    @Column({ type: 'varchar', length: 36 })
    patternId: string;

    @Column({ type: 'int' })
    prizeMinor: number;

    /** Master on/off switch, independent of the schedule below. */
    @Column({ type: 'boolean', default: false })
    enabled: boolean;

    @Column({ type: 'varchar', length: 10 })
    scheduleType: BingoBonusScheduleType;

    /** Absolute UTC window bounds. Only set when scheduleType = 'once'. */
    @Column({ type: 'timestamp', nullable: true })
    startAt: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    endAt: Date | null;

    /** Structured recurrence config. Only set when scheduleType = 'recurring'. */
    @Column({ type: 'json', nullable: true })
    recurrence: BingoBonusRecurrence | null;

    /**
     * When true, bots are steered to win THIS bonus (via the same real→bot
     * redirect mechanism used for Derash places, scoped only to this pattern)
     * while real players keep competing for Derash placements normally.
     */
    @Column({ type: 'boolean', default: false })
    botWinEnabled: boolean;

    /**
     * Max cartelas a bot may buy in a room while this campaign is active and
     * botWinEnabled is true. Overrides BingoConfig.botMaxCartelasPerBotPerRoom
     * (and forces at least 1) for the duration of the window only.
     */
    @Column({ type: 'int', default: 1 })
    botMaxCartelasPerRoom: number;

    @Column({ type: 'varchar', length: 36, nullable: true })
    createdBy: string | null;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
