import { IsBoolean, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

export class UpdateWithdrawalFeeRangeDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  minAmountMinor?: number;

  /** Null = open-ended ("and above"). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  maxAmountMinor?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  feeMinor?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
