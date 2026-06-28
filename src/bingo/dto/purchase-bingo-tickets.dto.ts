import { IsArray, IsInt, IsOptional, Max, Min } from 'class-validator';

export class PurchaseBingoTicketsDto {
  @IsInt()
  @Min(1)
  @Max(24)
  count: number;

  /**
   * Optional player-chosen numbers for the first ticket.
   * Partial lists are accepted — the backend fills remaining spots randomly.
   * For pattern mode (5×5): provide numbers within each column's range.
   * For line mode (90-ball): provide up to 15 numbers from 1–90.
   */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  selectedNumbers?: number[];
}
