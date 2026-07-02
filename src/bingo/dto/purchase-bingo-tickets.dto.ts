import { IsArray, IsInt, IsOptional, Max, Min } from 'class-validator';

export class PurchaseBingoTicketsDto {
  /** Number of cards to buy (line/pattern mode). Defaults to 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  count?: number;

  /** Spot number to buy (prefilled mode only). */
  @IsOptional()
  @IsInt()
  @Min(1)
  spotNumber?: number;

  /**
   * Optional player-chosen numbers for the first ticket (line/pattern mode).
   * Partial lists are accepted — the backend fills remaining spots randomly.
   */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  selectedNumbers?: number[];
}
