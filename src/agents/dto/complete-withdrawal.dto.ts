import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class CompleteWithdrawalDto {
  /** Which rail the agent used to pay the player. */
  @IsIn(['telebirr', 'mpesa'])
  provider: 'telebirr' | 'mpesa';

  /**
   * The payout proof: a Telebirr receipt number/URL, or the full M-PESA
   * confirmation SMS. Verified server-side before the player's coins are released.
   */
  @IsString()
  @MinLength(6)
  @MaxLength(1000)
  proof: string;
}
