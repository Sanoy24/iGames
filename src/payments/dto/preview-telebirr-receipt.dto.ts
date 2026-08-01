import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class PreviewTelebirrReceiptDto {
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
}
