import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { SupportService } from './support.service';
import { PostMessageDto } from './dto/post-message.dto';

/** Player-facing support — one persistent conversation per user. */
@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /** The caller's single support conversation (thread + messages). */
  @Get('conversation')
  getConversation(@CurrentUser() user: AuthenticatedUser) {
    return this.support.getMyConversation(user.id);
  }

  /** Post a message (optionally a tagged refund/dispute/complaint request). */
  @Post('messages')
  @Throttle({ strict: { ttl: 60_000, limit: 20 } })
  postMessage(@CurrentUser() user: AuthenticatedUser, @Body() dto: PostMessageDto) {
    // A player can never post an internal note, regardless of payload.
    return this.support.postUserMessage(user.id, { ...dto, internal: false });
  }
}
