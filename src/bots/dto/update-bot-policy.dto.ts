import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const STRATEGIES = ['conservative', 'normal', 'aggressive', 'mirror-human'] as const;

export class UpdateBotPolicyDto {
  @ApiPropertyOptional({ example: 2 })
  @IsOptional() @IsInt() @Min(1) @Max(12)
  ticketsPerRound?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional() @IsInt() @Min(1) @Max(12)
  spotCount?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional() @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Allow this bot to play Keno' })
  @IsOptional() @IsBoolean()
  kenoActive?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Allow this bot to play Bingo' })
  @IsOptional() @IsBoolean()
  bingoActive?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Allow this bot to play Crash' })
  @IsOptional() @IsBoolean()
  crashActive?: boolean;

  @ApiPropertyOptional({ enum: STRATEGIES, example: 'normal' })
  @IsOptional() @IsIn(STRATEGIES)
  kenoStrategy?: typeof STRATEGIES[number];

  @ApiPropertyOptional({ enum: STRATEGIES, example: 'mirror-human' })
  @IsOptional() @IsIn(STRATEGIES)
  bingoStrategy?: typeof STRATEGIES[number];

  @ApiPropertyOptional({ enum: STRATEGIES, example: 'normal' })
  @IsOptional() @IsIn(STRATEGIES)
  crashStrategy?: typeof STRATEGIES[number];

  @ApiPropertyOptional({ example: 100, minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  kenoParticipationRatePct?: number;

  @ApiPropertyOptional({ example: 150, description: 'Keno bot reaction delay minimum in ms' })
  @IsOptional() @IsInt() @Min(0)
  kenoActionDelayMinMs?: number;

  @ApiPropertyOptional({ example: 900, description: 'Keno bot reaction delay maximum in ms' })
  @IsOptional() @IsInt() @Min(0)
  kenoActionDelayMaxMs?: number;

  @ApiPropertyOptional({ example: 35, minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  kenoHesitationChancePct?: number;

  @ApiPropertyOptional({ example: 20, minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  kenoVariancePct?: number;

  @ApiPropertyOptional({ example: 100, minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  bingoParticipationRatePct?: number;

  @ApiPropertyOptional({ example: 250, description: 'Bingo bot reaction delay minimum in ms' })
  @IsOptional() @IsInt() @Min(0)
  bingoActionDelayMinMs?: number;

  @ApiPropertyOptional({ example: 1200, description: 'Bingo bot reaction delay maximum in ms' })
  @IsOptional() @IsInt() @Min(0)
  bingoActionDelayMaxMs?: number;

  @ApiPropertyOptional({ example: 45, minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  bingoHesitationChancePct?: number;

  @ApiPropertyOptional({ example: 25, minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  bingoVariancePct?: number;

  @ApiPropertyOptional({ example: 60, minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  crashParticipationRatePct?: number;

  @ApiPropertyOptional({ example: 80, description: 'Crash bot reaction delay minimum in ms' })
  @IsOptional() @IsInt() @Min(0)
  crashActionDelayMinMs?: number;

  @ApiPropertyOptional({ example: 600, description: 'Crash bot reaction delay maximum in ms' })
  @IsOptional() @IsInt() @Min(0)
  crashActionDelayMaxMs?: number;

  @ApiPropertyOptional({ example: 20, minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  crashHesitationChancePct?: number;

  @ApiPropertyOptional({ example: 18, minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100)
  crashVariancePct?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the minimum-balance guard' })
  @IsOptional() @IsInt() @Min(0)
  kenoMinBalanceMinor?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the minimum-balance guard' })
  @IsOptional() @IsInt() @Min(0)
  bingoMinBalanceMinor?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the minimum-balance guard' })
  @IsOptional() @IsInt() @Min(0)
  crashMinBalanceMinor?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the daily stake cap' })
  @IsOptional() @IsInt() @Min(0)
  kenoMaxStakeMinorPerDay?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the daily stake cap' })
  @IsOptional() @IsInt() @Min(0)
  bingoMaxStakeMinorPerDay?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the daily stake cap' })
  @IsOptional() @IsInt() @Min(0)
  crashMaxStakeMinorPerDay?: number;

  @ApiPropertyOptional({ example: 24, minimum: 1, maximum: 24 })
  @IsOptional() @IsInt() @Min(1) @Max(24)
  bingoMaxCartelasPerRoom?: number;

  @ApiPropertyOptional({ example: 120, description: 'Crash bot minimum auto-cashout multiplier x100' })
  @IsOptional() @IsInt() @Min(101)
  crashMinCashoutX100?: number;

  @ApiPropertyOptional({ example: 250, description: 'Crash bot maximum auto-cashout multiplier x100' })
  @IsOptional() @IsInt() @Min(101)
  crashMaxCashoutX100?: number;
}

export class TopupBotDto {
  @ApiPropertyOptional({ example: 100000, description: 'Amount to add in minor units' })
  @IsInt() @Min(1)
  amountMinor: number;
}
