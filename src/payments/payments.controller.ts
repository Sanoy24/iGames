import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { SubmitTelebirrReceiptDto } from './dto/submit-telebirr-receipt.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('telebirr/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Parsed receipt details — wallet is NOT credited' })
  previewTelebirrReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitTelebirrReceiptDto,
  ) {
    return this.paymentsService.previewTelebirrReceipt(user.id, dto);
  }

  @Post('telebirr/receipts')
  @ApiCreatedResponse({
    schema: {
      example: {
        id: '665f...',
        receiptNo: 'ADQ123',
        amountMinor: 50000,
        currencyCode: 'CREDIT',
        status: 'credited'
      }
    }
  })
  submitTelebirrReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitTelebirrReceiptDto
  ) {
    return this.paymentsService.submitTelebirrReceipt(user.id, dto);
  }
}
