import { IsISO8601, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class AdminCompleteWithdrawalDto {
  @IsUUID()
  agentId: string;

  @IsString()
  @MinLength(4)
  telebirrReference: string;

  @IsString()
  @MinLength(1)
  receiptFileUrl: string;

  /** Defaults to now when omitted. */
  @IsOptional()
  @IsISO8601()
  transferCompletedAt?: string;
}
