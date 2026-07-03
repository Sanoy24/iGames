import { IsInt, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class PlaceCrashBetDto {
  @IsInt()
  @Min(1)
  stakeMinor: number;

  // Optional auto-cashout target multiplier (e.g. 1.50 = cash out at 1.50×)
  @IsOptional()
  @IsNumber()
  @Min(1.01)
  @Max(100)
  autoCashoutAt?: number;
}
