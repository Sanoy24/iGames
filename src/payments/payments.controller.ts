import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { SubmitTelebirrReceiptDto } from './dto/submit-telebirr-receipt.dto';
import { PaymentsService } from './payments.service';
import { AgentsService } from '../agents/agents.service';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly agentsService: AgentsService,
  ) {}

  /**
   * The Telebirr deposit destination — the agent currently on shift.
   * Players send their Telebirr transfer to this name/number before
   * submitting the receipt. Returns null when no agent is on shift.
   */
  @Get('active-agent')
  @ApiOkResponse({
    description: 'Active agent Telebirr deposit details, or null if nobody is on shift',
  })
  getActiveAgent() {
    return this.agentsService.getActiveAgentDepositInfo();
  }

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
