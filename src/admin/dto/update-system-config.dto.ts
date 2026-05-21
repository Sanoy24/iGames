import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

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
