import { Controller, Get, Post, Body, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { UsersService } from '../users/users.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly usersService: UsersService
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
  async getUsers() {
    // A real implementation would paginate this, but for now we just return top 100
    return this.usersService.listUsers(100);
  }

  @Put('users/:id/status')
  async updateUserStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.usersService.updateStatus(id, status as any);
  }
}
