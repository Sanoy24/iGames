import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { PreviewMpesaSmsDto } from './preview-mpesa-sms.dto';

export class SubmitMpesaSmsDto extends PreviewMpesaSmsDto {
    @ApiPropertyOptional({
        description:
            'Relative path (from POST /payments/receipts/upload) to the uploaded receipt photo/PDF. Optional  the pasted SMS text alone is enough to verify and credit the deposit.',
    })
    @IsOptional()
    @IsString()
    @MinLength(1)
    receiptFileUrl?: string;
}
