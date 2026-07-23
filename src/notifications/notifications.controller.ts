import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { MarkReadDto } from './dto/mark-read.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@SkipThrottle()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.notificationsService.list(user.id, limit ? parseInt(limit, 10) || 30 : 30);
  }

  @Post('read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkReadDto) {
    return this.notificationsService.markRead(user.id, dto.ids);
  }
}
