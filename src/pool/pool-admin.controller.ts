import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
  constructor(
    private readonly poolService: PoolService,
    private readonly tournaments: PoolTournamentService,
  ) {}

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
