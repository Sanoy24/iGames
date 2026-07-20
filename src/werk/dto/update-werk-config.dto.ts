import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { WerkMazeTheme, WerkWinningMode } from '../entities/werk-config.entity';

/**
 * Partial update of the Werk Flega config. Every field optional so admins can
 * change one setting without re-sending the row. Cross-field checks (min <= max
 * stake, botCount < totalPlayers) are enforced in the service.
 */
export class UpdateWerkConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  entryStakeMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minStakeMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxStakeMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  totalPlayers?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  botCount?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(600)
  gameDurationSec?: number;

  @IsOptional()
  @IsIn(['A', 'B'])
  winningMode?: WerkWinningMode;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(15)
  finalSprintWarningSec?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(30)
  coinDensityX100?: number;

  @IsOptional()
  @IsBoolean()
  powerupsEnabled?: boolean;

  @IsOptional()
  @IsIn(['adwa', 'highland', 'desert'])
  mazeTheme?: WerkMazeTheme;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  payoutRank1MultX100?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  payoutRank2MultX100?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  payoutRank3MultX100?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  payoutRank4MultX100?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  payoutRank5MultX100?: number;
}
