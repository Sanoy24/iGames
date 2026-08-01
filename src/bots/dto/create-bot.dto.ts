import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min
} from 'class-validator';

const STRATEGIES = ['conservative', 'normal', 'aggressive', 'mirror-human'] as const;

export class CreateBotDto {
  @ApiProperty({ example: 'Lucky Bot 1', description: 'Display name shown in the game' })
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @ApiPropertyOptional({ example: 1, description: 'Tickets purchased per draw', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  ticketsPerRound?: number;

  @ApiPropertyOptional({ example: 3, description: 'Numbers picked per ticket', default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  spotCount?: number;

  @ApiPropertyOptional({ example: true, description: 'Allow this bot to play Keno', default: true })
  @IsOptional()
  @IsBoolean()
  kenoActive?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Allow this bot to play Bingo', default: true })
  @IsOptional()
  @IsBoolean()
  bingoActive?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Allow this bot to play Crash', default: true })
  @IsOptional()
  @IsBoolean()
  crashActive?: boolean;

  @ApiPropertyOptional({ enum: STRATEGIES, example: 'normal' })
  @IsOptional()
  @IsIn(STRATEGIES)
  kenoStrategy?: typeof STRATEGIES[number];

  @ApiPropertyOptional({ enum: STRATEGIES, example: 'mirror-human' })
  @IsOptional()
  @IsIn(STRATEGIES)
  bingoStrategy?: typeof STRATEGIES[number];

  @ApiPropertyOptional({ enum: STRATEGIES, example: 'normal' })
  @IsOptional()
  @IsIn(STRATEGIES)
  crashStrategy?: typeof STRATEGIES[number];

  @ApiPropertyOptional({ example: 100, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  kenoParticipationRatePct?: number;

  @ApiPropertyOptional({ example: 100, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  bingoParticipationRatePct?: number;

  @ApiPropertyOptional({ example: 60, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  crashParticipationRatePct?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the minimum-balance guard' })
  @IsOptional()
  @IsInt()
  @Min(0)
  kenoMinBalanceMinor?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the minimum-balance guard' })
  @IsOptional()
  @IsInt()
  @Min(0)
  bingoMinBalanceMinor?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the minimum-balance guard' })
  @IsOptional()
  @IsInt()
  @Min(0)
  crashMinBalanceMinor?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the daily stake cap' })
  @IsOptional()
  @IsInt()
  @Min(0)
  kenoMaxStakeMinorPerDay?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the daily stake cap' })
  @IsOptional()
  @IsInt()
  @Min(0)
  bingoMaxStakeMinorPerDay?: number;

  @ApiPropertyOptional({ example: 0, description: '0 disables the daily stake cap' })
  @IsOptional()
  @IsInt()
  @Min(0)
  crashMaxStakeMinorPerDay?: number;

  @ApiPropertyOptional({ example: 24, minimum: 1, maximum: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  bingoMaxCartelasPerRoom?: number;

  @ApiPropertyOptional({ example: 120, description: 'Crash bot minimum auto-cashout multiplier x100' })
  @IsOptional()
  @IsInt()
  @Min(101)
  crashMinCashoutX100?: number;

  @ApiPropertyOptional({ example: 250, description: 'Crash bot maximum auto-cashout multiplier x100' })
  @IsOptional()
  @IsInt()
  @Min(101)
  crashMaxCashoutX100?: number;

  @ApiPropertyOptional({
    example: 100000,
    description: 'Initial wallet balance in minor units',
    default: 100000
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  initialBalanceMinor?: number;
}
