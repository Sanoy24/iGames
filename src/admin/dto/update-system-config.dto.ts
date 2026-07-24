import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

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

  /** % of a credited deposit paid as commission to the receiving agent. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  depositCommissionPct?: number;

  /** User id of the super-admin whose wallet receives service fees (null = none). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  superAdminUserId?: string | null;

  /** Minimum accepted Telebirr deposit (minor units). 0 = no minimum. */
  @IsOptional()
  @IsInt()
  @Min(0)
  minDepositMinor?: number;

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

  /** Enable per-agent Bingo rooms (Approach B). */
  @IsOptional()
  @IsBoolean()
  agentRoomsEnabled?: boolean;

  /** % of a room's real-player GGR paid to the owning agent on completion. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  agentRoomCommissionPct?: number;
}
