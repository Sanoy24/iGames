import { IsString, Matches, MinLength, IsOptional, IsNumber, Min, Max, IsObject, IsArray, ValidateIf } from 'class-validator';

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @Matches(/^(\+?251|0)[79]\d{8}$/, { message: 'Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX or +2519XXXXXXXX)' })
  phoneNumber?: string;

  /** M-Pesa deposit destination, if different from phoneNumber. Pass null to clear (falls back to phoneNumber). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^(\+?251|0)[79]\d{8}$/, { message: 'Enter a valid Ethiopian phone number (e.g. 09XXXXXXXX or +2519XXXXXXXX)' })
  mpesaPhoneNumber?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(2)
  displayName?: string;

  @IsOptional()
  @IsString()
  @IsOptional()
  password?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(23)
  workStartHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(59)
  workStartMinute?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(23)
  workEndHour?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(59)
  workEndMinute?: number;

  /** Days the agent works (0=Sun..6=Sat). Empty = every day. */
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workDaysOfWeek?: number[];

  @IsOptional()
  @IsObject()
  agentPermissions?: {
    deposit: boolean;
    withdraw: boolean;
  };

  @IsOptional()
  @IsString()
  status?: 'active' | 'suspended' | 'closed';

  /** This agent's referral-commission % override. Pass null to clear (use the global default). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  @Max(100)
  referralCommissionPct?: number | null;

  /** This agent's per-game referral-commission % overrides (keno/crash/pool/werk). Missing key = no override for that game. */
  @IsOptional()
  @IsObject()
  referralCommissionPctByGame?: Partial<
    Record<'keno' | 'crash' | 'pool' | 'werk', number>
  >;
}
