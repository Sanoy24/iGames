import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class VerifyWithdrawalDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  /** Required (min 15 chars, enforced in AdminService) when rejecting. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
