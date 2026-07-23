import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { BroadcastParseMode, BroadcastScheduleType } from '../entities/broadcast-message.entity';

export class BroadcastButtonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  text: string;

  // Telegram inline URL buttons require an http(s) or tg:// link.
  @IsString()
  @Matches(/^(https?:\/\/|tg:\/\/)/i, { message: 'Button url must start with http://, https:// or tg://' })
  @MaxLength(2048)
  url: string;
}

export class BroadcastRecurrenceDto {
  @IsIn(['daily', 'weekly'])
  frequency: 'daily' | 'weekly';

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'time must be HH:mm (24h)' })
  time: string;

  @ValidateIf((o) => o.frequency === 'weekly')
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;
}

export class CreateBroadcastDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  // Just the basename returned by the upload endpoint; the server resolves it to
  // an absolute path under the uploads dir (guards against path traversal).
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'Invalid image reference' })
  @MaxLength(200)
  imageFilename?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => BroadcastButtonDto)
  buttons?: BroadcastButtonDto[];

  @IsOptional()
  @IsIn(['none', 'HTML', 'MarkdownV2'])
  parseMode?: BroadcastParseMode;

  @IsIn(['now', 'once', 'recurring'])
  scheduleType: BroadcastScheduleType;

  // Local wall-clock "YYYY-MM-DDTHH:mm" (interpreted with timezoneOffsetMinutes).
  // Required when scheduleType = 'once'.
  @ValidateIf((o) => o.scheduleType === 'once')
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, { message: 'scheduledAtLocal must be YYYY-MM-DDTHH:mm' })
  scheduledAtLocal?: string;

  @ValidateIf((o) => o.scheduleType === 'recurring')
  @ValidateNested()
  @Type(() => BroadcastRecurrenceDto)
  recurrence?: BroadcastRecurrenceDto;

  @IsOptional()
  @IsInt()
  @Min(-720)
  @Max(840)
  timezoneOffsetMinutes?: number;

  // Save as a draft instead of scheduling/sending (ignored for scheduleType 'now').
  @IsOptional()
  @IsBoolean()
  asDraft?: boolean;
}
