import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { PreviewTelebirrReceiptDto } from './preview-telebirr-receipt.dto';

export class SubmitTelebirrReceiptDto extends PreviewTelebirrReceiptDto {
    @ApiPropertyOptional({
        description:
            'Relative path (from POST /payments/receipts/upload) to the uploaded receipt photo/PDF. Optional  the receipt number/URL alone is enough to verify and credit the deposit.',
    })
    @IsOptional()
    @IsString()
    @MinLength(1)
    receiptFileUrl?: string;
}
