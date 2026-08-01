import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { PreviewMpesaSmsDto } from './preview-mpesa-sms.dto';

export class SubmitMpesaSmsDto extends PreviewMpesaSmsDto {
  @ApiProperty({
    description: 'Relative path (from POST /payments/receipts/upload) to the uploaded receipt photo/PDF.'
  })
  @IsString()
  @MinLength(1)
  receiptFileUrl: string;
}
