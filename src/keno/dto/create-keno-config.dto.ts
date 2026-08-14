import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested
} from 'class-validator';

export class KenoPaytableEntryDto {
  @IsInt()
  @Min(1)
  @Max(12)
  spots: number;

  @IsInt()
  @Min(0)
  @Max(12)
  matches: number;

  @IsInt()
  @Min(0)
  payoutMultiplier: number;
}

export class CreateKenoConfigDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  numberMin?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  numberMax?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  drawSize?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  allowedSpots?: number[];

  @IsInt()
  @Min(1)
  ticketPriceMinor: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minStakeMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxStakeMinor?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => KenoPaytableEntryDto)
  paytable: KenoPaytableEntryDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  globalBotWinInterval?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  autoScheduleIntervalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  autoScheduleIntervalSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxWinnersPerDraw?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  winChancePct?: number;
}
