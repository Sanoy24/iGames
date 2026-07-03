import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class BingoPatternPrizeDto {
  @IsString()
  patternId: string;

  @IsString()
  name: string;

  @IsInt()
  @Min(0)
  prizeMinor: number;
}

export class BingoPrizeConfigDto {
  @IsInt()
  @Min(0)
  oneLineMinor: number;

  @IsInt()
  @Min(0)
  twoLinesMinor: number;

  @IsInt()
  @Min(0)
  fullHouseMinor: number;
}

export class CreateBingoRoomDto {
  @IsString()
  name: string;

  @IsInt()
  @Min(1)
  ticketPriceMinor: number;

  @IsInt()
  @Min(1)
  maxTickets: number;

  @ValidateNested()
  @Type(() => BingoPrizeConfigDto)
  prizes: BingoPrizeConfigDto;

  @IsOptional()
  @IsDateString()
  scheduledStartAt?: string;

  @IsOptional()
  @IsIn(['line', 'pattern', 'prefilled'])
  winMode?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  numberRange?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  gridSize?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BingoPatternPrizeDto)
  patternPrizes?: BingoPatternPrizeDto[];
}
