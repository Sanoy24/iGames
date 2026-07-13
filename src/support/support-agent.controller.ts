import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { SupportService } from './support.service';
import { PostMessageDto } from './dto/post-message.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { ApproveRefundDto, RejectRefundDto } from './dto/resolve-refund.dto';
import { ListTicketsQuery } from './dto/list-tickets.query';

/** Agent/admin support console: inbox, replies, assignment, refund decisions. */
@ApiTags('support-agent')
@ApiBearerAuth()
@SkipThrottle()
@Controller('agent/support')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('agent', 'admin')
export class SupportAgentController {
  constructor(private readonly support: SupportService) {}

  @Get('tickets')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListTicketsQuery) {
    return this.support.listTickets(query, user.id);
  }

  @Get('tickets/:id')
  get(@Param('id') id: string) {
    return this.support.getTicketForAgent(id);
  }

  @Post('tickets/:id/messages')
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PostMessageDto,
  ) {
    return this.support.postAgentMessage(user.id, id, dto);
  }

  @Patch('tickets/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.support.updateTicket(user.id, id, dto);
  }

  @Post('tickets/:id/claim')
  claim(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.support.claimTicket(user.id, id);
  }

  @Post('tickets/:id/refund/approve')
  approveRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveRefundDto,
  ) {
    return this.support.approveRefund(user.id, id, dto);
  }

  @Post('tickets/:id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectRefundDto,
  ) {
    return this.support.rejectTicket(user.id, id, dto);
  }
}
