import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min
} from 'class-validator';

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
