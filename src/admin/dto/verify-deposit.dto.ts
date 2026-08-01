import { IsIn } from 'class-validator';

export class VerifyDepositDto {
  @IsIn(['telebirr', 'mpesa'])
  provider: 'telebirr' | 'mpesa';

  @IsIn(['verified', 'flagged'])
  verificationStatus: 'verified' | 'flagged';
}
