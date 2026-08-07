import { IsBoolean, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateSystemConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  telebirrCreditMinorPerBirr?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  welcomeBonusMinor?: number;

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
  /** Global default % of a referred player's Bingo GGR paid to the referring agent. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  referralCommissionPct?: number;

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
