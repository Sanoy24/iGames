import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOkResponse({
    schema: {
      example: {
        id: '665f...',
        userId: '665f...',
        currencyCode: 'CREDIT',
        availableMinor: 0,
        reservedMinor: 0,
        status: 'active'
      }
    }
  })
  getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getDefaultWalletSummary(user.id);
  }

  @Get('ledger')
  @ApiOkResponse({
    schema: {
      example: [
        {
          id: '665f...',
          walletId: '665f...',
          currencyCode: 'CREDIT',
          amountMinor: 100,
          direction: 'debit',
          entryType: 'stake',
          sourceType: 'keno_ticket',
          sourceId: 'ticket-1',
          idempotencyKey: 'request-uuid',
          balanceAfterMinor: 900,
          metadata: {}
        }
      ]
    }
  })
  getLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number
  ) {
    return this.walletService.getLedgerEntries({
      userId: user.id,
      limit
    });
  }
}
