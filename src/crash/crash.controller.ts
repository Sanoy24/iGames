import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CrashService } from './crash.service';
import { PlaceCrashBetDto } from './dto/place-crash-bet.dto';

@ApiTags('crash')
@ApiBearerAuth()
@SkipThrottle({ default: true })
@UseGuards(JwtAuthGuard)
@Controller('crash')
export class CrashController {
  constructor(private readonly crashService: CrashService) {}

  @Public()
  @Get('config')
  getConfig() {
    return this.crashService.getConfig();
  }

  @Public()
  @Get('active')
  @ApiOkResponse({ description: 'The current waiting or running round, or null' })
  getActiveRound() {
    return this.crashService.getActiveRound();
  }

  @Public()
  @Get('rounds')
  @ApiOkResponse({ description: 'Recent completed rounds (crash points revealed)' })
  getRecentRounds(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.crashService.getRecentRounds(limit);
  }

  @Get('bets')
  @ApiOkResponse({ description: 'My recent bets across all rounds' })
  getMyBets(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.crashService.getMyRecentBets(user.id, limit);
  }

  @Get('rounds/:id/bets')
  @ApiOkResponse({ description: 'My bets for a specific round' })
  getMyBetsForRound(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') roundId: string,
  ) {
    return this.crashService.getMyBetsForRound(user.id, roundId);
  }

  @Post('rounds/:id/bet')
  @Throttle({ strict: { ttl: 60_000, limit: 30 } })
  placeBet(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') roundId: string,
    @Body() dto: PlaceCrashBetDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.crashService.placeBet(user.id, roundId, dto, idempotencyKey);
  }

  @Post('rounds/:id/cashout')
  @Throttle({ strict: { ttl: 60_000, limit: 60 } })
  cashOut(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') roundId: string,
    @Body('multiplierX100', ParseIntPipe) multiplierX100: number,
  ) {
    return this.crashService.cashOut(user.id, roundId, multiplierX100);
  }
}
