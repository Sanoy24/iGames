import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class SubmitTelebirrReceiptDto {
  @ApiPropertyOptional({
    description: 'Telebirr receipt number from SMS.'
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{4,80}$/)
  receiptNo?: string;

  @ApiPropertyOptional({
    description: 'Full Telebirr receipt URL. The backend extracts the receipt number.'
  })
  @IsOptional()
  @IsString()
  receiptUrl?: string;

  @ApiProperty({
    description: 'Relative path (from POST /payments/receipts/upload) to the uploaded receipt photo/PDF.'
  })
  @IsString()
  @MinLength(1)
  receiptFileUrl: string;
}
