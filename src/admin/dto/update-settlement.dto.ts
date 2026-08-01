import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateSettlementDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'paid', 'rejected'])
  status?: 'pending' | 'approved' | 'paid' | 'rejected';

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(['bank_transfer', 'cash', 'mobile_money', 'other'])
  paymentMethod?: 'bank_transfer' | 'cash' | 'mobile_money' | 'other' | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(255)
  ftNumber?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  receiptFileUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  paidAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountPaidMinor?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}
