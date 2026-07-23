import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { WerkService } from './werk.service';
import { UpdateWerkConfigDto } from './dto/update-werk-config.dto';
import { CreateWerkBotDto } from './dto/create-werk-bot.dto';
import { UpdateWerkBotDto } from './dto/update-werk-bot.dto';

/** Admin control over Werk Flega config (stakes, round shape, mode, prizes). */
@ApiTags('admin-werk')
@ApiBearerAuth()
@SkipThrottle()
@Controller('admin/werk')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class WerkAdminController {
  private readonly logger = new Logger(WerkAdminController.name);

  constructor(private readonly werkService: WerkService) {}

  @Get('config')
  getConfig() {
    return this.werkService.getConfig();
  }

  @Patch('config')
  async updateConfig(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateWerkConfigDto) {
    try {
      return await this.werkService.updateConfig(dto, user.id);
    } catch (err) {
      this.logger.error(
        `updateConfig failed for admin ${user.id}: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  // ── Bot pool management ─────────────────────────────────────────────────────

  @Get('bots')
  listBots() {
    return this.werkService.listBots();
  }

  @Post('bots')
  async createBot(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWerkBotDto) {
    try {
      return await this.werkService.createBot(dto, user.id);
    } catch (err) {
      this.logger.error(
        `createBot failed for admin ${user.id}: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  @Patch('bots/:id')
  async updateBot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWerkBotDto,
  ) {
    try {
      return await this.werkService.updateBot(id, dto);
    } catch (err) {
      this.logger.error(
        `updateBot ${id} failed for admin ${user.id}: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  @Delete('bots/:id')
  deleteBot(@Param('id', ParseIntPipe) id: number) {
    return this.werkService.deleteBot(id);
  }
}
