import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PoolService } from './pool.service';
import { UpdatePoolConfigDto } from './dto/update-pool-config.dto';

/** Admin control over Pool config: single-player, two-player, and tournament modes. */
@ApiTags('admin-pool')
@ApiBearerAuth()
@SkipThrottle()
@Controller('admin/pool')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class PoolAdminController {
  constructor(private readonly poolService: PoolService) {}

  @Get('config')
  getConfig() {
    return this.poolService.getConfig();
  }

  @Patch('config')
  updateConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePoolConfigDto,
  ) {
    return this.poolService.updateConfig(dto, user.id);
  }
}
