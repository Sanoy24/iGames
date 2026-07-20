import { Body, Controller, Get, Logger, Patch, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { WerkService } from './werk.service';
import { UpdateWerkConfigDto } from './dto/update-werk-config.dto';

/** Admin control over Werk Flega config (stakes, round shape, mode, prizes). */
@ApiTags('admin-werk')
@ApiBearerAuth()
@SkipThrottle()
@Controller('admin/werk')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class WerkAdminController {
  private readonly logger = new Logger(WerkAdminController.name);

  constructor(private readonly werkService: WerkService) {}

  @Get('config')
  getConfig() {
    return this.werkService.getConfig();
  }

  @Patch('config')
  async updateConfig(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateWerkConfigDto) {
    try {
      return await this.werkService.updateConfig(dto, user.id);
    } catch (err) {
      this.logger.error(
        `updateConfig failed for admin ${user.id}: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }
}
