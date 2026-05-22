import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AgentsService } from './agents.service';
import { CompleteWithdrawalDto } from './dto/complete-withdrawal.dto';

@ApiTags('agent')
@ApiBearerAuth()
@SkipThrottle()
@Controller('agent')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('agent')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  /**
   * The shift currently active (who should be handling withdrawals right now).
   */
  @Get('shifts/active')
  getActiveShift() {
    return this.agentsService.getActiveShift();
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
    return this.agentsService.completeWithdrawal(id, agent.id, dto.telebirrReference);
  }
}
