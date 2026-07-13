import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { GamesService } from './games.service';
import { GameCode } from './entities/game-setting.entity';
import { UpdateGameSettingDto } from './dto/update-game-setting.dto';

/** Admin control over game availability (enable / maintenance / hidden). */
@ApiTags('admin-games')
@ApiBearerAuth()
@SkipThrottle()
@Controller('admin/games')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class GamesAdminController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  list() {
    return this.gamesService.getAdminList();
  }

  @Patch(':code')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: GameCode,
    @Body() dto: UpdateGameSettingDto,
  ) {
    return this.gamesService.updateSetting(code, dto, user.id);
  }
}
