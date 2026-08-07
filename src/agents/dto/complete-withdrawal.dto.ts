import {
    IsDateString,
    IsIn,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';

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

    /** Relative path (from the receipt-upload endpoint) to the agent's uploaded
     * payout receipt  required evidence for the admin verification step. */
    @IsString()
    @MinLength(1)
    @MaxLength(500)
    receiptFileUrl: string;

    /** When the agent actually transferred the money  agent-entered (defaults to
     * "now" in the UI, editable), distinct from the server-stamped submission time. */
    @IsDateString()
    transferCompletedAt: string;
}
