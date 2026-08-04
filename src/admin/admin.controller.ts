import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
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
import { VerifyDepositDto } from './dto/verify-deposit.dto';
import { VerifyWithdrawalDto } from './dto/verify-withdrawal.dto';
import { AdminCompleteWithdrawalDto } from './dto/admin-complete-withdrawal.dto';
import { CreateWithdrawalFeeRangeDto } from './dto/create-withdrawal-fee-range.dto';
import { UpdateWithdrawalFeeRangeDto } from './dto/update-withdrawal-fee-range.dto';
import { ConfigChangeType } from './entities/config-change-log.entity';
import { AdminTopupDto, AdminTransferToAgentDto } from './dto/wallet-ops.dto';
import { CreateShiftDto } from '../agents/dto/create-shift.dto';
import { AssignAgentLocationsDto } from '../locations/dto/assign-agent-locations.dto';
import { CreateLocationDto } from '../locations/dto/create-location.dto';
import { UpdateLocationDto } from '../locations/dto/update-location.dto';
import { LocationsService } from '../locations/locations.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { GameEventsGateway } from '../events/game-events.gateway';
import { AgentsService } from '../agents/agents.service';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { UpdateSettlementDto } from './dto/update-settlement.dto';
import { UPLOADS_ROOT, RECEIPT_MIME_TYPES } from '../common/uploads.constants';

/** Minimal shape of a multer file (avoids depending on @types/multer). */
type UploadedReceiptFile = { filename: string; mimetype: string; size: number };

const SETTLEMENT_RECEIPT_SUBDIR = 'settlement-receipts';
const SETTLEMENT_RECEIPT_DIR = join(UPLOADS_ROOT, SETTLEMENT_RECEIPT_SUBDIR);

// Same subdir the agent's own withdrawal-proof upload uses — an admin
// completing a withdrawal on an agent's behalf stores the receipt in the same
// place a self-service agent submission would.
const WITHDRAWAL_RECEIPT_SUBDIR = 'withdrawal-receipts';
const WITHDRAWAL_RECEIPT_DIR = join(UPLOADS_ROOT, WITHDRAWAL_RECEIPT_SUBDIR);

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
    private readonly agentsService: AgentsService,
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

  @Patch('deposits/:id/verify')
  verifyDeposit(
    @Param('id') id: string,
    @Body() dto: VerifyDepositDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminService.verifyDeposit(dto.provider, id, dto.verificationStatus, admin.id);
  }

  @Get('config')
  getConfig() {
    return this.adminService.getSystemConfig();
  }

  @Post('config')
  updateConfig(
    @Body() dto: UpdateSystemConfigDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminService.updateSystemConfig(dto, admin.id);
  }

  @Get('config-history')
  getConfigHistory(
    @Query('configType') configType?: ConfigChangeType,
    @Query('entityId') entityId?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return this.adminService.listConfigChanges(configType, entityId, parseInt(page, 10) || 1, parseInt(limit, 10) || 50);
  }

  // ── Withdrawal fee ranges ─────────────────────────────────────────

  @Get('withdrawal-fee-ranges')
  listWithdrawalFeeRanges() {
    return this.adminService.listWithdrawalFeeRanges();
  }

  @Post('withdrawal-fee-ranges')
  createWithdrawalFeeRange(
    @Body() dto: CreateWithdrawalFeeRangeDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminService.createWithdrawalFeeRange(dto, admin.id);
  }

  @Patch('withdrawal-fee-ranges/:id')
  updateWithdrawalFeeRange(
    @Param('id') id: string,
    @Body() dto: UpdateWithdrawalFeeRangeDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminService.updateWithdrawalFeeRange(id, dto, admin.id);
  }

  @Delete('withdrawal-fee-ranges/:id')
  deleteWithdrawalFeeRange(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminService.deleteWithdrawalFeeRange(id, admin.id);
  }

  // ── Users ─────────────────────────────────────────────────────────

  @Get('users')
  async getUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('role') role?: string,
    @Query('search') search?: string,
    @Query('isBot') isBot?: string,
    @Query('status') status?: 'active' | 'suspended' | 'closed',
    @Query('online') online?: string,
    @Query('hasPhone') hasPhone?: string,
    @Query('minBalanceMinor') minBalanceMinor?: string,
    @Query('maxBalanceMinor') maxBalanceMinor?: string,
  ) {
    const onlineIds = this.gameEventsGateway.getOnlineUserIds();
    const result = await this.usersService.listUsers(
      parseInt(page, 10) || 1,
      parseInt(limit, 10) || 50,
      role,
      search,
      {
        isBot: isBot === 'true' ? true : isBot === 'false' ? false : undefined,
        status,
        online: online === 'true' ? true : online === 'false' ? false : undefined,
        onlineUserIds: [...onlineIds],
        hasPhone: hasPhone === 'true' ? true : hasPhone === 'false' ? false : undefined,
        minBalanceMinor: minBalanceMinor !== undefined ? parseInt(minBalanceMinor, 10) : undefined,
        maxBalanceMinor: maxBalanceMinor !== undefined ? parseInt(maxBalanceMinor, 10) : undefined,
      },
    );
    return {
      ...result,
      data: result.data.map((user) => ({
        ...user,
        online: onlineIds.has(user.id),
        isBot: !!(user.productMetadata as { botPolicy?: unknown } | undefined)?.botPolicy,
      })),
    };
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
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminService.adjustUserWallet(userId, body.amountMinor, body.direction, body.reason, admin.id);
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
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminService.updateAgentWithAudit(id, dto, admin.id);
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

  // ── Agent Settlements ────────────────────────────────────────────
  // Real-world payouts to an agent — separate from what they've earned.

  /** Upload a photo/PDF of the payment receipt — required before a settlement
   * can be marked 'paid'. Admin-uploaded per the business rule. */
  @Post('settlements/receipts/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(SETTLEMENT_RECEIPT_DIR, { recursive: true });
          cb(null, SETTLEMENT_RECEIPT_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (!RECEIPT_MIME_TYPES.includes(file.mimetype)) {
          cb(new UnsupportedMediaTypeException('Only JPEG, PNG, WEBP, GIF images or PDF are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadSettlementReceipt(@UploadedFile() file?: UploadedReceiptFile) {
    if (!file) throw new BadRequestException('No receipt file uploaded');
    return { fileUrl: `${SETTLEMENT_RECEIPT_SUBDIR}/${file.filename}` };
  }

  @Get('settlements')
  listAllSettlements(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return this.agentsService.listSettlements(undefined, parseInt(page, 10) || 1, parseInt(limit, 10) || 50);
  }

  @Get('agents/:id/settlements')
  listAgentSettlements(
    @Param('id') id: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return this.agentsService.listSettlements(id, parseInt(page, 10) || 1, parseInt(limit, 10) || 50);
  }

  @Post('agents/:id/settlements')
  createSettlement(@Param('id') id: string, @Body() dto: CreateSettlementDto) {
    return this.agentsService.createSettlement(id, new Date(dto.periodStart), new Date(dto.periodEnd), dto.notes);
  }

  @Patch('settlements/:id')
  updateSettlement(
    @Param('id') id: string,
    @Body() dto: UpdateSettlementDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.agentsService.updateSettlement(
      id,
      {
        status: dto.status,
        paymentMethod: dto.paymentMethod,
        ftNumber: dto.ftNumber,
        receiptFileUrl: dto.receiptFileUrl,
        paidAt: dto.paidAt !== undefined ? (dto.paidAt === null ? null : new Date(dto.paidAt)) : undefined,
        amountPaidMinor: dto.amountPaidMinor,
        notes: dto.notes,
      },
      admin.id,
    );
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

  /**
   * Admin verification of an agent-submitted withdrawal (FT number + receipt) —
   * only valid while status is 'awaiting_verification'. Approving is what
   * actually releases the player's fund-hold and credits the agent; rejecting
   * refunds the reservation. See WalletService.verifyAgentWithdrawal.
   */
  @Post('withdrawals/:id/verify')
  verifyWithdrawal(
    @Param('id') id: string,
    @Body() dto: VerifyWithdrawalDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.walletService.verifyAgentWithdrawal(id, dto.decision, admin.id, dto.notes);
  }

  /**
   * Admin-direct completion — records the agent/fee/reference/receipt and
   * completes the withdrawal in one step, for a payout an agent already made
   * outside the self-service claim flow. Only valid from 'pending'/'processing'
   * (the same set the bare "process" approve accepts). The fee is always
   * resolved server-side from the active WithdrawalFeeRange table, never taken
   * from the request body. See WalletService.adminCompleteWithdrawal.
   */
  @Post('withdrawals/:id/complete-with-agent')
  async completeWithdrawalWithAgent(
    @Param('id') id: string,
    @Body() dto: AdminCompleteWithdrawalDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    // The fee goes to the Master Wallet here (not the agent) — an admin is
    // recording/authorizing this payout rather than the agent self-submitting
    // it, so the house keeps the cut. See WalletService.adminCompleteWithdrawal.
    const houseWalletUserId = await this.adminService.getOrCreateMasterWalletUserId();
    return this.walletService.adminCompleteWithdrawal({
      withdrawalId: id,
      agentId: dto.agentId,
      telebirrReference: dto.telebirrReference,
      receiptFileUrl: dto.receiptFileUrl,
      adminUserId: admin.id,
      houseWalletUserId,
      transferCompletedAt: dto.transferCompletedAt ? new Date(dto.transferCompletedAt) : undefined,
    });
  }

  /** Upload a photo/PDF of the payout receipt when an admin is completing a
   * withdrawal directly (see completeWithdrawalWithAgent above). */
  @Post('withdrawals/receipts/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(WITHDRAWAL_RECEIPT_DIR, { recursive: true });
          cb(null, WITHDRAWAL_RECEIPT_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (!RECEIPT_MIME_TYPES.includes(file.mimetype)) {
          cb(new UnsupportedMediaTypeException('Only JPEG, PNG, WEBP, GIF images or PDF are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadWithdrawalReceipt(@UploadedFile() file?: UploadedReceiptFile) {
    if (!file) throw new BadRequestException('No receipt file uploaded');
    return { fileUrl: `${WITHDRAWAL_RECEIPT_SUBDIR}/${file.filename}` };
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
