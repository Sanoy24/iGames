import { Body, Controller, Get, Logger, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { WerkService } from './werk.service';
import { StartWerkGameDto } from './dto/start-werk-game.dto';
import { SettleWerkGameDto } from './dto/settle-werk-game.dto';

/** Player-facing Werk Flega: read config, start a game, settle / abort it. */
@ApiTags('werk')
@Controller('werk')
export class WerkController {
  private readonly logger = new Logger(WerkController.name);

  constructor(private readonly werkService: WerkService) {}

  @Public()
  @SkipThrottle({ default: true })
  @Get('config')
  @ApiOkResponse({ description: 'Current Werk Flega configuration (stakes, mode, prizes, maze params)' })
  getConfig() {
    return this.werkService.getConfigView();
  }

  @Post('start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ strict: { ttl: 60_000, limit: 20 } })
  @ApiOkResponse({ description: 'Start a game: debits the entry stake and returns the layout seed' })
  async start(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartWerkGameDto) {
    try {
      return await this.werkService.startGame(user.id, dto);
    } catch (err) {
      this.logger.error(
        `start failed for user ${user.id}: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @SkipThrottle({ default: true })
  getSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.werkService.getSession(user.id, id);
  }

  @Post(':id/settle')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'Report final standings; credits any prize' })
  async settle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SettleWerkGameDto,
  ) {
    try {
      return await this.werkService.settle(user.id, id, dto);
    } catch (err) {
      this.logger.error(
        `settle failed for user ${user.id} game ${id}: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  @Post(':id/abort')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'Abandon an unfinished game; refunds the stake' })
  abort(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.werkService.abort(user.id, id);
  }
}
