import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateBingoConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  autoRepeatIntervalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultTicketPriceMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultMaxTickets?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultOneLineMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultTwoLinesMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultFullHouseMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  drawIntervalSeconds?: number;
}
