import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';
import type { BingoBonusScheduleType } from '../entities/bingo-bonus-campaign.entity';
import { BingoBonusRecurrenceDto } from './create-bingo-bonus-campaign.dto';

const SCHEDULE_TYPES: BingoBonusScheduleType[] = ['once', 'recurring'];

export class CreateBingoScheduledBotPlayDto {
    @IsString()
    name: string;

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

    @IsInt()
    @Min(1)
    botCount: number;

    @IsInt()
    @Min(1)
    maxCartelasPerBot: number;

    /** Optional lower bound; when set (and below maxCartelasPerBot) each bot buys
     * a random amount in [minCartelasPerBot, maxCartelasPerBot] instead of a
     * fixed amount. */
    @IsOptional()
    @IsInt()
    @Min(1)
    minCartelasPerBot?: number;
}

export class UpdateBingoScheduledBotPlayDto {
    @IsOptional()
    @IsString()
    name?: string;

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
    @IsInt()
    @Min(1)
    botCount?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    maxCartelasPerBot?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    minCartelasPerBot?: number;
}
