import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';
import type {
    BingoBonusRecurrenceFrequency,
    BingoBonusScheduleType,
} from '../entities/bingo-bonus-campaign.entity';

const SCHEDULE_TYPES: BingoBonusScheduleType[] = ['once', 'recurring'];
const RECURRENCE_FREQUENCIES: BingoBonusRecurrenceFrequency[] = [
    'daily',
    'weekly',
];
const HH_MM_SS = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

export class BingoBonusRecurrenceDto {
    @IsIn(RECURRENCE_FREQUENCIES)
    frequency: BingoBonusRecurrenceFrequency;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(6)
    dayOfWeek?: number;

    @Matches(HH_MM_SS, {
        message: 'startTime must be HH:mm:ss',
    })
    startTime: string;

    @Matches(HH_MM_SS, {
        message: 'endTime must be HH:mm:ss',
    })
    endTime: string;
}

export class CreateBingoBonusCampaignDto {
    @IsString()
    name: string;

    @IsString()
    patternId: string;

    @IsInt()
    @Min(1)
    prizeMinor: number;

    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @IsIn(SCHEDULE_TYPES)
    scheduleType: BingoBonusScheduleType;

    /** Addis Ababa local wall-clock datetime, "YYYY-MM-DDTHH:mm:ss". Required when scheduleType = 'once'. */
    @IsOptional()
    @IsString()
    startAt?: string;

    @IsOptional()
    @IsString()
    endAt?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => BingoBonusRecurrenceDto)
    recurrence?: BingoBonusRecurrenceDto;

    @IsOptional()
    @IsBoolean()
    botWinEnabled?: boolean;

    @IsOptional()
    @IsInt()
    @Min(1)
    botMaxCartelasPerRoom?: number;
}

export class UpdateBingoBonusCampaignDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    patternId?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    prizeMinor?: number;

    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @IsOptional()
    @IsIn(SCHEDULE_TYPES)
    scheduleType?: BingoBonusScheduleType;

    @IsOptional()
    @IsString()
    startAt?: string;

    @IsOptional()
    @IsString()
    endAt?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => BingoBonusRecurrenceDto)
    recurrence?: BingoBonusRecurrenceDto;

    @IsOptional()
    @IsBoolean()
    botWinEnabled?: boolean;

    @IsOptional()
    @IsInt()
    @Min(1)
    botMaxCartelasPerRoom?: number;
}
