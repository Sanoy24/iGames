import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, UseInterceptors, Query, ParseIntPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AdminAuditInterceptor } from './admin-audit.interceptor';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AdminAuditInterceptor)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService
  ) {}

  @Get('stats/overview')
  async getOverview() {
    return this.adminService.getPlatformStats();
  }

  @Get('config')
  async getConfig() {
    return this.adminService.getSystemConfig();
  }

  @Post('config')
  async updateConfig(@Body() update: any) {
    return this.adminService.updateSystemConfig(update);
  }

  @Get('users')
  async getUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50'
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    return this.usersService.listUsers(pageNum, limitNum);
  }

  @Put('users/:id/status')
  async updateUserStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.usersService.updateStatus(id, status as any);
  }

  @Post('users/:id/wallet/adjust')
  async adjustUserWallet(
    @Param('id') userId: string,
    @Body() body: { amountMinor: number; direction: 'credit' | 'debit'; reason: string }
  ) {
    return this.adminService.adjustUserWallet(userId, body.amountMinor, body.direction, body.reason);
  }

  @Get('withdrawals')
  async getWithdrawals() {
    return this.walletService.getAllWithdrawals();
  }

  @Post('withdrawals/:id/process')
  async processWithdrawal(
    @Param('id') id: string,
    @Body() body: { action: 'approve' | 'reject'; adminNotes?: string },
    @CurrentUser() admin: AuthenticatedUser
  ) {
    return this.walletService.processWithdrawal(id, body.action, body.adminNotes, admin.id);
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
}
