import {
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ALL_WERK_PERSONALITIES, type WerkBotPersonality } from '../entities/werk-config.entity';

/** Create a new admin-managed house bot. */
export class CreateWerkBotDto {
  @IsString()
  @Length(1, 64)
  name: string;

  @IsString()
  @Length(1, 64)
  nameEn: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsIn(ALL_WERK_PERSONALITIES)
  personality?: WerkBotPersonality;

  /** Optional per-bot speed override (% of human); omit to follow config base. */
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(100)
  speedPct?: number | null;

  /** Optional per-bot skill override (0–100); omit to follow config base. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  skillPct?: number | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}
