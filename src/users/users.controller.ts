import { Body, Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { BingoService } from '../bingo/bingo.service';
import { KenoService } from '../keno/keno.service';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JoinReferralDto } from './dto/join-referral.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly kenoService: KenoService,
    private readonly bingoService: BingoService,
    private readonly usersService: UsersService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  /** Null agent when the player hasn't entered a referral code (or joined via one at signup). */
  @Get('me/referral')
  getMyReferralStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getReferralStatus(user.id);
  }

  /** One-time referral code/link entry from the Mini App  see UsersService.joinReferralCode. */
  @Post('me/referral')
  @HttpCode(HttpStatus.OK)
  joinReferral(@CurrentUser() user: AuthenticatedUser, @Body() dto: JoinReferralDto) {
    return this.usersService.joinReferralCode(user.id, dto.code);
  }

  @Get('me/history')
  async getMyHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number
  ) {
    const kenoTickets = await this.kenoService.listTicketsForUser({
      userId: user.id,
      limit
    });
    
    const bingoTickets = await this.bingoService.listTicketsForUser({
      userId: user.id,
      limit
    });

    const combined = [
      ...kenoTickets.map(t => ({ ...t, game: 'keno' as const, date: this.extractDateFromObjectId(t.id) })),
      ...bingoTickets.map(t => ({ ...t, game: 'bingo' as const, date: this.extractDateFromObjectId(t.id) }))
    ];

    combined.sort((a, b) => b.date.getTime() - a.date.getTime());

    return combined.slice(0, limit).map(({ date, ...rest }) => ({
      ...rest,
      createdAt: date
    }));
  }

  private extractDateFromObjectId(objectId: string): Date {
    return new Date(parseInt(objectId.substring(0, 8), 16) * 1000);
  }
}
