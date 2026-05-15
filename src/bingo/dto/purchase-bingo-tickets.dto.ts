import { IsInt, Max, Min } from 'class-validator';

export class PurchaseBingoTicketsDto {
  @IsInt()
  @Min(1)
  @Max(24)
  count: number;
}
