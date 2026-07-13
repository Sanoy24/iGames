import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Agent/admin: approve a refund ticket, crediting the player's wallet. */
export class ApproveRefundDto {
  /**
   * Amount to refund in minor units. Defaults to the ticket's requested amount
   * when omitted. Provide a smaller value for a partial refund.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  amountMinor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Agent/admin: reject a refund/dispute or otherwise resolve a ticket. */
export class RejectRefundDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}
