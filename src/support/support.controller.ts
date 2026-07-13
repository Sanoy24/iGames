import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { SupportService } from './support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { PostMessageDto } from './dto/post-message.dto';

/** Player-facing support surface. Every action is scoped to the caller's tickets. */
@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('tickets')
  @Throttle({ strict: { ttl: 60_000, limit: 5 } })
  createTicket(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTicketDto) {
    return this.support.createTicket(user.id, dto);
  }

  @Get('tickets')
  listMyTickets(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.support.listMyTickets(user.id, limit ? parseInt(limit, 10) || 30 : 30);
  }

  @Get('tickets/:id')
  getMyTicket(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.support.getMyTicket(user.id, id);
  }

  @Post('tickets/:id/messages')
  @Throttle({ strict: { ttl: 60_000, limit: 20 } })
  postMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PostMessageDto,
  ) {
    // A player can never post an internal note, regardless of payload.
    return this.support.postUserMessage(user.id, id, { ...dto, internal: false });
  }

  @Post('tickets/:id/close')
  closeTicket(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.support.closeMyTicket(user.id, id);
  }
}
