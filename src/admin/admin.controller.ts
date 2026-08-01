import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AdminAuditInterceptor } from './admin-audit.interceptor';
import { AdminService } from './admin.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { SetAgentOnDutyDto } from './dto/set-agent-on-duty.dto';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { AdminTopupDto, AdminTransferToAgentDto } from './dto/wallet-ops.dto';
import { CreateShiftDto } from '../agents/dto/create-shift.dto';
import { AssignAgentLocationsDto } from '../locations/dto/assign-agent-locations.dto';
import { CreateLocationDto } from '../locations/dto/create-location.dto';
import { UpdateLocationDto } from '../locations/dto/update-location.dto';
import { LocationsService } from '../locations/locations.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { GameEventsGateway } from '../events/game-events.gateway';

@SkipThrottle()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly locationsService: LocationsService,
    private readonly gameEventsGateway: GameEventsGateway,
  ) {}

  @Get('stats/overview')
  getOverview() {
    return this.adminService.getPlatformStats();
  }

  @Get('game-transactions')
  getGameTransactions(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return this.adminService.getGameTransactions(parseInt(page, 10) || 1, parseInt(limit, 10) || 50);
  }

  @Get('deposits')
  listDeposits(
    @Query('provider') provider: 'telebirr' | 'mpesa' = 'telebirr',
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('status') status?: 'credited' | 'rejected',
    @Query('agentId') agentId?: string,
  ) {
    return this.adminService.listDeposits(
      provider === 'mpesa' ? 'mpesa' : 'telebirr',
      parseInt(page, 10) || 1,
      parseInt(limit, 10) || 20,
      { status, agentId },
    );
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
  async getUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('role') role?: string,
    @Query('search') search?: string,
  ) {
    const result = await this.usersService.listUsers(
      parseInt(page, 10) || 1,
      parseInt(limit, 10) || 50,
      role,
      search,
    );
    const onlineIds = this.gameEventsGateway.getOnlineUserIds();
    return { ...result, data: result.data.map((user) => ({ ...user, online: onlineIds.has(user.id) })) };
  }

  @Get('users/:id/activity')
  getUserActivity(
    @Param('id') userId: string,
    @Query('limit') limit: string = '20',
  ) {
    return this.adminService.getUserActivity(userId, parseInt(limit, 10) || 20);
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

  @Patch('agents/:id')
  updateAgent(
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.usersService.updateAgentUser(id, dto);
  }

  @Patch('agents/:id/on-duty')
  setAgentOnDuty(
    @Param('id') id: string,
    @Body() dto: SetAgentOnDutyDto,
  ) {
    return this.usersService.setAgentOnDutyMode(id, dto.mode);
  }

  @Get('agents/actions')
  getAgentActions(@Query('limit') limit: string = '100') {
    return this.adminService.getAgentActions(parseInt(limit, 10) || 100);
  }

  @Get('agents/performance')
  getAgentPerformance() {
    return this.adminService.getAgentPerformance();
  }

  // ── Locations ─────────────────────────────────────────────────────

  @Get('locations')
  listLocations() {
    return this.locationsService.listLocationsForAdmin();
  }

  @Post('locations')
  createLocation(@Body() dto: CreateLocationDto) {
    return this.locationsService.createLocation(dto);
  }

  @Patch('locations/:id')
  updateLocation(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locationsService.updateLocation(id, dto);
  }

  @Delete('locations/:id')
  deleteLocation(@Param('id') id: string) {
    return this.locationsService.deleteLocation(id);
  }

  @Get('locations/:id/agents')
  listLocationAgents(@Param('id') id: string) {
    return this.locationsService.listLocationAgents(id);
  }

  @Get('agents/:id/locations')
  listAgentLocations(@Param('id') id: string) {
    return this.locationsService.listAgentLocations(id);
  }

  /** Replaces the agent's whole assignment set. */
  @Put('agents/:id/locations')
  setAgentLocations(@Param('id') id: string, @Body() dto: AssignAgentLocationsDto) {
    return this.locationsService.setAgentLocations(id, dto);
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

  // ── Admin Wallet Operations (shared house wallet — see AdminService) ──

  @Get('wallet/house')
  getHouseWallet() {
    return this.adminService.getHouseWallet();
  }

  @Post('wallet/topup')
  topupWallet(
    @Body() dto: AdminTopupDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminService.adminTopup(admin.id, dto.amountMinor, dto.idempotencyKey);
  }

  @Post('wallet/transfer-to-agent')
  transferToAgent(
    @Body() dto: AdminTransferToAgentDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminService.transferAdminToAgent(admin.id, dto.agentId, dto.amountMinor, dto.idempotencyKey);
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
