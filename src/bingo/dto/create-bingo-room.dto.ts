import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

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
}
