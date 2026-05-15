import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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
