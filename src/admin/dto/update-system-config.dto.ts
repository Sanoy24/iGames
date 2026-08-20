import { IsBoolean, IsInt, IsNumber, IsObject, IsOptional, Max, Min } from 'class-validator';

export class UpdateSystemConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  telebirrCreditMinorPerBirr?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  welcomeBonusMinor?: number;

  /** Master on/off switch for the welcome bonus, independent of the amount. */
  @IsOptional()
  @IsBoolean()
  welcomeBonusEnabled?: boolean;

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

  /** Minimum balance a user's wallet must retain; withdrawals cannot drop below it. 0 = no floor. */
  @IsOptional()
  @IsInt()
  @Min(0)
  minWalletBalanceMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxPendingWithdrawalsPerUser?: number;

  /** Enable per-agent Bingo rooms (Approach B). */
  @IsOptional()
  @IsBoolean()
  agentRoomsEnabled?: boolean;

  /** % of a room's real-player GGR paid to the owning agent on completion. */
  /** Global default % of a referred player's Bingo GGR paid to the referring agent. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  referralCommissionPct?: number;

  /** Global default referral-commission % per game (keno/crash/pool/werk). Bingo uses referralCommissionPct above. */
  @IsOptional()
  @IsObject()
  referralCommissionPctByGame?: Partial<
    Record<'keno' | 'crash' | 'pool' | 'werk', number>
  >;

  /** Minimum hours between an agent's own self-service settlement requests. 0 = no cooldown. */
  @IsOptional()
  @IsInt()
  @Min(0)
  agentSettlementCooldownHours?: number;

  /** Player-facing Leaderboard tab  off shows a Coming Soon placeholder to everyone. */
  @IsOptional()
  @IsBoolean()
  leaderboardEnabled?: boolean;

  /** Home page Live Wins Ticker  off shows rotating trust messages instead of win data. */
  @IsOptional()
  @IsBoolean()
  recentWinsEnabled?: boolean;
}
