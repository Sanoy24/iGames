import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { PoolBotDifficulty } from '../entities/pool-config.entity';

/**
 * Partial update of the Pool config. Every field is optional so admins can
 * toggle one mode without re-sending the whole row. Cross-field checks (e.g.
 * min <= max stake) are enforced in the service.
 */
export class UpdatePoolConfigDto {
  // ── Single player ─────────────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  singlePlayerEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  singlePlayerStakeMinor?: number;

  @IsOptional()
  @IsIn(['easy', 'medium', 'hard'])
  botDifficulty?: PoolBotDifficulty;

  // ── Two player ────────────────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  twoPlayerEnabled?: boolean;

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
  @Min(0)
  @Max(100)
  rakePct?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(300)
  shotClockSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxTimeoutFouls?: number;

  // ── Tournament ────────────────────────────────────────────────────────────
  @IsOptional()
  @IsBoolean()
  tournamentEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  tournamentEntryFeeMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(128)
  tournamentSize?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  tournamentRakePct?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  tournamentPrize1Weight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  tournamentPrize2Weight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  tournamentPrize34Weight?: number;

  // ── Physics tuning ────────────────────────────────────────────────────────
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  slidingFrictionX100?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  rollingFrictionX1000?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  cushionReboundPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ballReboundPct?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(300)
  pocketSizePct?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(1200)
  cueMaxSpeedX100?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  maxSideSpin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(400)
  maxRollSpin?: number;

  // ── Global ────────────────────────────────────────────────────────────────
  @IsOptional()
  @IsInt()
  @Min(1)
  rulesetVersion?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  engineVersion?: number;
}
