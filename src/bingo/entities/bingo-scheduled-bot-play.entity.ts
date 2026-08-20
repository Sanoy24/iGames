import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import type {
    BingoBonusRecurrence,
    BingoBonusScheduleType,
} from './bingo-bonus-campaign.entity';

/**
 * An admin-scheduled window during which the platform proactively starts and
 * fills prefilled/derash rooms using ONLY bots  no real player required at
 * all (unlike every other bot mechanic, which only ever reacts to a room a
 * real player already started). While a window is active and enabled, up to
 * `botCount` distinct bots each buy up to `maxCartelasPerBot` cartelas into
 * the current idle room, and the normal "cancel this room, it has no real
 * players" safety net stands down for that room (see BingoService.
 * reconcileBotCartelasInRoom / BotsService.topUpBotsForOpenRoom). A round
 * already in progress when the window closes finishes naturally  the
 * platform simply stops starting new bot-only rounds after that. Same
 * once/recurring Addis Ababa (UTC+3) schedule shape as BingoBonusCampaign,
 * and likewise rejects overlapping windows at write time (see
 * BingoService.assertNoBotPlayScheduleOverlap) so at most one is ever active.
 */
@Entity({ name: 'bingo_scheduled_bot_plays', engine: 'InnoDB ROW_FORMAT=DYNAMIC' })
export class BingoScheduledBotPlay {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** Admin label, e.g. "Overnight Activity". */
    @Column({ type: 'varchar', length: 100 })
    name: string;

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

    /** How many distinct active bots participate while this window is active. */
    @Column({ type: 'int', default: 1 })
    botCount: number;

    /** Max cartelas each participating bot may buy, for this schedule only. */
    @Column({ type: 'int', default: 1 })
    maxCartelasPerBot: number;

    @Column({ type: 'varchar', length: 36, nullable: true })
    createdBy: string | null;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
