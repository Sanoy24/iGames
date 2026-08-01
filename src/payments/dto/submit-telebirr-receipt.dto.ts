import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { PreviewTelebirrReceiptDto } from './preview-telebirr-receipt.dto';

export class SubmitTelebirrReceiptDto extends PreviewTelebirrReceiptDto {
  @ApiProperty({
    description: 'Relative path (from POST /payments/receipts/upload) to the uploaded receipt photo/PDF.'
  })
  @IsString()
  @MinLength(1)
  receiptFileUrl: string;
}
