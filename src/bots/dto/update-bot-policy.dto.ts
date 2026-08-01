import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

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
}

export class TopupBotDto {
  @ApiPropertyOptional({ example: 100000, description: 'Amount to add in minor units' })
  @IsInt() @Min(1)
  amountMinor: number;
}
