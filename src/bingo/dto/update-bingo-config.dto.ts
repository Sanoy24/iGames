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

  @IsOptional() @IsInt() @Min(5)
  salesWindowSeconds?: number;

  @IsOptional() @IsInt() @Min(0)
  resultDisplaySeconds?: number;

  @IsOptional() @IsIn(['line', 'pattern', 'prefilled'])
  defaultWinMode?: string;

  @IsOptional() @IsInt() @Min(10)
  defaultNumberRange?: number;

  @IsOptional() @IsInt() @Min(10)
  defaultGridSize?: number;

  @IsOptional() @IsInt() @Min(0)
  minDrawsBeforeWin?: number;

  @IsOptional() @IsInt() @Min(0)
  minTicketsToStart?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  houseEdgePct?: number;

  @IsOptional() @IsInt() @Min(0)
  globalBingoBotWinInterval?: number;

  @IsOptional() @IsInt() @Min(1) @Max(100)
  prefilledFirstPlacePct?: number;

  @IsOptional() @IsBoolean()
  prefilledSecondPlaceEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  prefilledSecondPlacePct?: number;

  @IsOptional() @IsBoolean()
  prefilledThirdPlaceEnabled?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  prefilledThirdPlacePct?: number;
}
