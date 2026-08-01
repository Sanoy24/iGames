import { Body, Controller, DefaultValuePipe, Get, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@SkipThrottle({ default: true })
@UseGuards(JwtAuthGuard, RolesGuard)
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

  // Only players hold a play-balance wallet that withdrawals draw down — admins
  // manage the shared Master Wallet via /admin/wallet/*, and agents receive
  // their working capital via admin transfer, never a self-service withdrawal
  // here. Without this, any authenticated JWT (including an admin's) could
  // request a withdrawal against their own always-dormant personal wallet.
  // Player-scoped fee preview — deliberately separate from GET /agent/config
  // (which is @Roles('agent')-gated) so a plain player token doesn't 403 when
  // the withdraw form fetches the fee tiers to display before submission.
  @Roles('player')
  @Get('withdrawal-fee-config')
  @ApiOkResponse({
    schema: {
      example: {
        withdrawalFeeRanges: [
          { minAmountMinor: 100, maxAmountMinor: 50000, feeMinor: 1000 },
          { minAmountMinor: 50001, maxAmountMinor: null, feeMinor: 10000 },
        ]
      }
    }
  })
  getWithdrawalFeeConfig() {
    return this.walletService.getWithdrawalFeeConfig();
  }

  @Roles('player')
  @Post('withdraw')
  @ApiOkResponse({
    schema: {
      example: {
        id: '665f...',
        userId: '665f...',
        amountMinor: 500,
        status: 'pending',
        destinationAccount: '0912345678',
        createdAt: '2026-05-21T12:00:00Z'
      }
    }
  })
  requestWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Body('amountMinor', ParseIntPipe) amountMinor: number,
    @Body('destinationAccount') destinationAccount: string
  ) {
    return this.walletService.requestWithdrawal(user.id, amountMinor, destinationAccount);
  }

  @Get('recent-wins')
  getRecentWins(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number
  ) {
    return this.walletService.getRecentPlatformWins(limit);
  }

  @Public()
  @Get('leaderboard')
  @ApiOkResponse({
    schema: {
      example: [
        { rank: 1, displayName: 'Player', totalWinMinor: 50000, winCount: 12 }
      ]
    }
  })
  getLeaderboard(
    @Query('period') period: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number
  ) {
    return this.walletService.getLeaderboard({ period, limit });
  }

  @Get('withdrawals')
  @ApiOkResponse({
    schema: {
      example: [
        {
          id: '665f...',
          userId: '665f...',
          amountMinor: 500,
          status: 'pending',
          destinationAccount: '0912345678',
          createdAt: '2026-05-21T12:00:00Z'
        }
      ]
    }
  })
  getWithdrawals(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getPlayerWithdrawals(user.id);
  }
}
