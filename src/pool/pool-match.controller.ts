import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PoolService } from './pool.service';
import { PoolMatchService } from './pool-match.service';
import { PoolMatchmakingService } from './pool-matchmaking.service';
import { PoolTournamentService } from './pool-tournament.service';
import { SubmitShotDto } from './dto/submit-shot.dto';
import { JoinQueueDto } from './dto/join-queue.dto';

/** Player-facing Pool: single-player, matchmaking, shots, and tournaments. */
@ApiTags('pool')
@ApiBearerAuth()
@SkipThrottle({ default: true })
@UseGuards(JwtAuthGuard)
@Controller('pool')
export class PoolMatchController {
  private readonly logger = new Logger(PoolMatchController.name);

  constructor(
    private readonly poolService: PoolService,
    private readonly matchService: PoolMatchService,
    private readonly matchmaking: PoolMatchmakingService,
    private readonly tournaments: PoolTournamentService,
  ) {}

  // ── Single player ───────────────────────────────────────────────────────────

  @Post('single')
  @ApiOkResponse({ description: 'Start a single-player game vs the AI' })
  async startSingle(@CurrentUser() user: AuthenticatedUser) {
    try {
      await this.poolService.assertModePlayable('single');
      const match = await this.matchService.createSingleMatch(user.id);
      return this.matchService.buildView(match);
    } catch (err) {
      this.logger.error(
        `startSingle failed for user ${user.id}: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  // ── Matchmaking ───────────────────────────────────────────────────────────

  @Post('queue')
  @Throttle({ strict: { ttl: 60_000, limit: 20 } })
  @ApiOkResponse({ description: 'Join the two-player queue at a stake; may return an immediate match' })
  join(@CurrentUser() user: AuthenticatedUser, @Body() dto: JoinQueueDto) {
    return this.matchmaking.join(user.id, dto.stakeMinor);
  }

  @Delete('queue')
  leave(@CurrentUser() user: AuthenticatedUser) {
    return this.matchmaking.leave(user.id);
  }

  @Get('queue')
  queueStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.matchmaking.status(user.id);
  }

  // ── Matches ───────────────────────────────────────────────────────────────

  @Get('matches/:id')
  async getMatch(@Param('id') id: string) {
    return this.matchService.buildView(await this.matchService.getMatch(id));
  }

  @Get('matches/:id/shots')
  @ApiOkResponse({ description: 'Ordered shot log for replay' })
  getShots(@Param('id') id: string) {
    return this.matchService.getShots(id);
  }

  @Post('matches/:id/shots')
  @Throttle({ strict: { ttl: 60_000, limit: 120 } })
  submitShot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SubmitShotDto,
  ) {
    return this.matchService.submitShot(id, user.id, {
      angle: dto.angle,
      power: dto.power,
      spin: { side: dto.spin.side, vertical: dto.spin.vertical },
      cuePos: dto.cuePos ? { x: dto.cuePos.x, y: dto.cuePos.y } : undefined,
    });
  }

  // ── Tournaments (player) ─────────────────────────────────────────────────

  @Get('tournaments/:id')
  getTournament(@Param('id') id: string) {
    return this.tournaments.get(id);
  }

  @Get('tournaments/:id/matches')
  getTournamentMatches(@Param('id') id: string) {
    return this.tournaments.listMatches(id);
  }

  @Post('tournaments/:id/register')
  @Throttle({ strict: { ttl: 60_000, limit: 10 } })
  register(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.tournaments.register(id, user.id);
  }
}
