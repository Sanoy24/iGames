import { IsBoolean, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

export class CreateWithdrawalFeeRangeDto {
  @IsInt()
  @Min(0)
  minAmountMinor: number;

  /** Null = open-ended ("and above"). Omit or pass null for the top tier. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  maxAmountMinor?: number | null;

  @IsInt()
  @Min(0)
  feeMinor: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
