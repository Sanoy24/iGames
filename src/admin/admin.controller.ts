import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AdminAuditInterceptor } from './admin-audit.interceptor';
import { AdminService } from './admin.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { CreateShiftDto } from '../agents/dto/create-shift.dto';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
  ) {}

  @Get('stats/overview')
  getOverview() {
    return this.adminService.getPlatformStats();
  }

  @Get('config')
  getConfig() {
    return this.adminService.getSystemConfig();
  }

  @Post('config')
  updateConfig(@Body() dto: UpdateSystemConfigDto) {
    return this.adminService.updateSystemConfig(dto);
  }

  // ── Users ─────────────────────────────────────────────────────────

  @Get('users')
  getUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return this.usersService.listUsers(parseInt(page, 10) || 1, parseInt(limit, 10) || 50);
  }

  @Put('users/:id/status')
  updateUserStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.usersService.updateStatus(id, status as any);
  }

  @Post('users/:id/wallet/adjust')
  adjustUserWallet(
    @Param('id') userId: string,
    @Body() body: { amountMinor: number; direction: 'credit' | 'debit'; reason: string },
  ) {
    return this.adminService.adjustUserWallet(userId, body.amountMinor, body.direction, body.reason);
  }

  @Get('users/:id/wager-limit')
  getWagerLimit(@Param('id') userId: string) {
    return this.walletService.getWagerLimit(userId);
  }

  @Put('users/:id/wager-limit')
  upsertWagerLimit(
    @Param('id') userId: string,
    @Body('dailyLimitMinor', ParseIntPipe) dailyLimitMinor: number,
    @Body('weeklyLimitMinor', ParseIntPipe) weeklyLimitMinor: number,
  ) {
    return this.walletService.upsertWagerLimit(userId, dailyLimitMinor, weeklyLimitMinor);
  }

  @Delete('users/:id/wager-limit')
  async deleteWagerLimit(@Param('id') userId: string) {
    await this.walletService.deleteWagerLimit(userId);
    return { deleted: true };
  }

  // ── Agents ────────────────────────────────────────────────────────

  @Post('agents')
  createAgent(@Body() dto: CreateAgentDto) {
    return this.adminService.createAgent(dto);
  }

  @Get('agents')
  listAgents(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return this.adminService.listAgents(parseInt(page, 10) || 1, parseInt(limit, 10) || 50);
  }

  // ── Withdrawals ───────────────────────────────────────────────────

  @Get('withdrawals')
  getAllWithdrawals() {
    return this.walletService.getAllWithdrawals();
  }

  @Post('withdrawals/:id/process')
  processWithdrawal(
    @Param('id') id: string,
    @Body() body: { action: 'approve' | 'reject'; adminNotes?: string },
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.walletService.processWithdrawal(id, body.action, body.adminNotes, admin.id);
  }

  // ── Agent Shifts ──────────────────────────────────────────────────

  @Get('shifts')
  listShifts() {
    return this.adminService.listShifts();
  }

  @Get('shifts/active')
  getActiveShift() {
    return this.adminService.getActiveShift();
  }

  @Post('shifts')
  createShift(@Body() dto: CreateShiftDto) {
    return this.adminService.createShift(dto);
  }

  @Put('shifts/:id')
  updateShift(@Param('id') id: string, @Body() dto: Partial<CreateShiftDto>) {
    return this.adminService.updateShift(id, dto);
  }

  @Delete('shifts/:id')
  async deleteShift(@Param('id') id: string) {
    await this.adminService.deleteShift(id);
    return { deleted: true };
  }

  // ── RNG Audit Logs ────────────────────────────────────────────────

  @Get('rng/audit-logs')
  getRngAuditLogs(
    @Query('gameType') gameType?: string,
    @Query('gameReference') gameReference?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return this.adminService.getRngAuditLogs({
      gameType,
      gameReference,
      page: parseInt(page, 10) || 1,
      limit: Math.min(parseInt(limit, 10) || 50, 100),
    });
  }
}
