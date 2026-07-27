import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AgentsService } from './agents.service';
import { CompleteWithdrawalDto } from './dto/complete-withdrawal.dto';
import { RejectWithdrawalDto } from './dto/reject-withdrawal.dto';
import { TransferToUserDto } from './dto/transfer-to-user.dto';
import { WalletService } from '../wallet/wallet.service';

@ApiTags('agent')
@ApiBearerAuth()
@SkipThrottle()
@Controller('agent')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('agent')
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Agent-accessible config — returns only the data agents need
   * (service charge %) without requiring admin role.
   */
  @Get('config')
  getConfig() {
    return this.agentsService.getAgentConfig();
  }

  /**
   * The shift currently active (who should be handling withdrawals right now).
   */
  @Get('shifts/active')
  getActiveShift() {
    return this.agentsService.getActiveShift();
  }

  /** The requesting agent's own Bingo performance (customers, GGR, commission). */
  @Get('performance')
  getMyPerformance(@CurrentUser() agent: AuthenticatedUser) {
    return this.agentsService.getPerformance(agent.id);
  }

  /**
   * All players registered in the agent's assigned location(s) — not scoped to
   * this agent's own referrals; flagged per-player via isMyReferral instead.
   * Always scoped off the authenticated agent, never a client-supplied id.
   */
  @Get('area/players')
  listAreaPlayers(
    @CurrentUser() agent: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.agentsService.listAreaPlayers(agent.id, {
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /**
   * Per-player drill-down: deposits, withdrawals, games played/won. 403s if
   * the player is not in one of the agent's assigned locations.
   */
  @Get('area/players/:userId/activity')
  getAreaPlayerActivity(@Param('userId') userId: string, @CurrentUser() agent: AuthenticatedUser) {
    return this.agentsService.getAreaPlayerActivity(agent.id, userId);
  }

  /**
   * List pending withdrawals available to claim.
   */
  @Get('withdrawals')
  getAvailableWithdrawals() {
    return this.agentsService.getAvailableWithdrawals();
  }

  /**
   * List withdrawals currently claimed by this agent.
   */
  @Get('withdrawals/my')
  getMyWithdrawals(@CurrentUser() agent: AuthenticatedUser) {
    return this.agentsService.getMyWithdrawals(agent.id);
  }

  @Get('transactions')
  getTransactions(@CurrentUser() agent: AuthenticatedUser) {
    return this.agentsService.getTransactionHistory(agent.id);
  }

  /**
   * Claim a pending withdrawal. The agent is then responsible for
   * doing the Telebirr transfer and confirming it.
   */
  @Post('withdrawals/:id/claim')
  @HttpCode(HttpStatus.OK)
  claimWithdrawal(@Param('id') id: string, @CurrentUser() agent: AuthenticatedUser) {
    return this.agentsService.claimWithdrawal(id, agent.id);
  }

  /**
   * Release a claimed withdrawal back to the pending pool.
   */
  @Post('withdrawals/:id/release')
  @HttpCode(HttpStatus.OK)
  releaseWithdrawal(@Param('id') id: string, @CurrentUser() agent: AuthenticatedUser) {
    return this.agentsService.releaseWithdrawal(id, agent.id);
  }

  /**
   * Reject a claimed withdrawal with mandatory remarks.
   */
  @Post('withdrawals/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectWithdrawal(
    @Param('id') id: string,
    @Body() dto: RejectWithdrawalDto,
    @CurrentUser() agent: AuthenticatedUser,
  ) {
    return this.walletService.rejectWithdrawalByAgent(id, agent.id, dto.remarks);
  }

  /**
   * Confirm that the Telebirr transfer has been completed.
   * Credits the agent's wallet with the net amount (after service charge)
   * and finalises the user's withdrawal.
   */
  @Post('withdrawals/:id/complete')
  @HttpCode(HttpStatus.OK)
  completeWithdrawal(
    @Param('id') id: string,
    @Body() dto: CompleteWithdrawalDto,
    @CurrentUser() agent: AuthenticatedUser,
  ) {
    return this.agentsService.completeWithdrawal(id, agent.id, dto.provider, dto.proof);
  }

  @Post('wallet/transfer-to-user')
  @HttpCode(HttpStatus.OK)
  transferToUser(
    @Body() dto: TransferToUserDto,
    @CurrentUser() agent: AuthenticatedUser,
  ) {
    return this.walletService.transferAgentToUser(agent.id, dto.phoneNumber, dto.amountMinor, dto.idempotencyKey);
  }
}
