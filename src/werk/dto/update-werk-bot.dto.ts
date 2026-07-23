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

/**
 * Partial update of a house bot. Every field optional. `speedPct`/`skillPct`
 * accept `null` to clear the override and fall back to the global config base.
 */
export class UpdateWerkBotDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  nameEn?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsIn(ALL_WERK_PERSONALITIES)
  personality?: WerkBotPersonality;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(100)
  speedPct?: number | null;

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
