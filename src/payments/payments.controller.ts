import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
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

  @Get('config')
  @ApiOkResponse({ description: 'Player-facing deposit rules (e.g. minimum deposit amount)' })
  getConfig() {
    return this.paymentsService.getPublicConfig();
  }

  /**
   * Open ops self-test (no login needed): confirms this server can reach
   * Ethiotelecom's receipt service, which Telebirr deposits depend on. Open it in
   * a browser: `/payments/telebirr/health` (or `?receipt=<realReceiptNo>` to also
   * test the full fetch + parse). Rate-limited; returns diagnostics only.
   */
  @Public()
  @Get('telebirr/health')
  @Throttle({ strict: { ttl: 60_000, limit: 10 } })
  @ApiQuery({ name: 'receipt', required: false, description: 'Optional real receipt no to test full fetch+parse' })
  @ApiOkResponse({ description: 'Egress diagnostics for the Telebirr receipt service' })
  telebirrHealth(@Query('receipt') receipt?: string) {
    return this.paymentsService.telebirrHealth(receipt);
  }

  // Both endpoints fetch the receipt from Ethiotelecom, so they are rate-limited
  // to curb abuse (spamming the upstream, brute-forcing receipt numbers).
  @Post('telebirr/preview')
  @Throttle({ strict: { ttl: 60_000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Parsed receipt details — wallet is NOT credited' })
  previewTelebirrReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitTelebirrReceiptDto,
  ) {
    return this.paymentsService.previewTelebirrReceipt(user.id, dto);
  }

  @Post('telebirr/receipts')
  @Throttle({ strict: { ttl: 60_000, limit: 12 } })
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
