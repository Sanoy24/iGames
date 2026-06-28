import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateBingoConfigDto {
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsInt() @Min(0)
  autoRepeatIntervalMinutes?: number;

  @IsOptional() @IsInt() @Min(1)
  defaultTicketPriceMinor?: number;

  @IsOptional() @IsInt() @Min(1)
  defaultMaxTickets?: number;

  @IsOptional() @IsInt() @Min(0)
  defaultOneLineMinor?: number;

  @IsOptional() @IsInt() @Min(0)
  defaultTwoLinesMinor?: number;

  @IsOptional() @IsInt() @Min(0)
  defaultFullHouseMinor?: number;

  @IsOptional() @IsInt() @Min(1)
  drawIntervalSeconds?: number;

  @IsOptional() @IsIn(['line', 'pattern'])
  defaultWinMode?: string;

  @IsOptional() @IsInt() @Min(10)
  defaultNumberRange?: number;

  @IsOptional() @IsInt() @Min(0)
  minDrawsBeforeWin?: number;

  @IsOptional() @IsInt() @Min(0)
  minTicketsToStart?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  houseEdgePct?: number;

  @IsOptional() @IsInt() @Min(0)
  globalBingoBotWinInterval?: number;
}
