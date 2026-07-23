import { Body, Controller, Get, Logger, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { WerkService } from './werk.service';
import { WerkRoundManager } from './round/werk-round-manager.service';
import { StartWerkGameDto } from './dto/start-werk-game.dto';

/** Player-facing Werk Flega: read config, view/join the shared round, leave it. */
@ApiTags('werk')
@Controller('werk')
export class WerkController {
  private readonly logger = new Logger(WerkController.name);

  constructor(
    private readonly werkService: WerkService,
    private readonly roundManager: WerkRoundManager,
  ) {}

  @Public()
  @SkipThrottle({ default: true })
  @Get('config')
  @ApiOkResponse({ description: 'Current Werk Flega configuration (stakes, mode, prizes, maze params)' })
  getConfig() {
    return this.werkService.getConfigView();
  }

  /** The round to render right now (lobby countdown, live game to spectate, or results). */
  @Get('current')
  @UseGuards(OptionalJwtAuthGuard)
  @SkipThrottle({ default: true })
  @ApiOkResponse({ description: 'Current shared round state for the lobby/spectator view' })
  getCurrent(@CurrentUser() user?: AuthenticatedUser) {
    return this.roundManager.getCurrentView(user?.id) ?? { status: 'none' };
  }

  /** Join the open lobby round (debits the entry stake). */
  @Post('join')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ strict: { ttl: 60_000, limit: 30 } })
  @ApiOkResponse({ description: 'Join the current lobby round; debits the entry stake' })
  async join(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartWerkGameDto) {
    try {
      return await this.roundManager.join(user.id, dto.stakeMinor);
    } catch (err) {
      this.logger.error(
        `join failed for user ${user.id}: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  /** Leave the current round; refunds the stake only while still in the lobby. */
  @Post('leave')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'Leave the current round; refunds the stake if still in the lobby' })
  leave(@CurrentUser() user: AuthenticatedUser) {
    return this.roundManager.leave(user.id);
  }
}
