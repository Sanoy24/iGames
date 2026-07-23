import { Body, Controller, Get, Logger, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PoolService } from './pool.service';
import { PoolTournamentService } from './pool-tournament.service';
import { UpdatePoolConfigDto } from './dto/update-pool-config.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';

/** Admin control over Pool config and tournament lifecycle. */
@ApiTags('admin-pool')
@ApiBearerAuth()
@SkipThrottle()
@Controller('admin/pool')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class PoolAdminController {
  private readonly logger = new Logger(PoolAdminController.name);

  constructor(
    private readonly poolService: PoolService,
    private readonly tournaments: PoolTournamentService,
  ) {}

  @Get('config')
  getConfig() {
    return this.poolService.getConfig();
  }

  @Patch('config')
  async updateConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePoolConfigDto,
  ) {
    try {
      return await this.poolService.updateConfig(dto, user.id);
    } catch (err) {
      this.logger.error(
        `updateConfig failed for admin ${user.id} (fields: ${Object.keys(dto).join(', ') || 'none'}): ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  // ── Tournaments ──────────────────────────────────────────────────────────

  @Post('tournaments')
  createTournament(@Body() dto: CreateTournamentDto) {
    return this.tournaments.create(dto.name ?? '');
  }

  @Post('tournaments/:id/start')
  startTournament(@Param('id') id: string) {
    return this.tournaments.start(id);
  }
}
