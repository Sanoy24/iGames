import { IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

export class UpdateSystemConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  telebirrCreditMinorPerBirr?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  welcomeBonusMinor?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  withdrawalServiceChargePct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  withdrawalCommissionPct?: number;

  /** User id of the super-admin whose wallet receives service fees (null = none). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  superAdminUserId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  withdrawalMinAmountMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  withdrawalMaxAmountMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxPendingWithdrawalsPerUser?: number;
}
