import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GameEventsGateway } from '../events/game-events.gateway';
import { CreateKenoConfigDto } from './dto/create-keno-config.dto';
import { KenoService } from './keno.service';

@ApiTags('admin-keno')
@ApiBearerAuth()
@SkipThrottle()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/keno')
export class KenoAdminController {
  constructor(
    private readonly kenoService: KenoService,
    private readonly gameEventsGateway: GameEventsGateway
  ) {}

  @Post('configs')
  @ApiCreatedResponse({
    schema: { example: { name: 'Default Keno', version: 2, status: 'active' } }
  })
  createConfig(@Body() dto: CreateKenoConfigDto) {
    return this.kenoService.createConfig(dto);
  }

  @Get('configs')
  listConfigs() {
    return this.kenoService.listConfigs();
  }

  @Post('draws')
  scheduleDraw(@Body('scheduledAt') scheduledAt?: string) {
    const date = scheduledAt ? new Date(scheduledAt) : undefined;
    return this.kenoService.scheduleDraw(date);
  }

  @Post('draws/execute-next')
  async executeNextOpenDraw() {
    const result = await this.kenoService.executeNextOpenDraw();
    this.gameEventsGateway.emitKenoDrawCompleted(result);
    void this.kenoService.notifyDrawWinners(result.id).catch(() => undefined);
    return result;
  }

  @Post('draws/:id/execute')
  async executeDraw(@Param('id') drawId: string) {
    const result = await this.kenoService.executeDraw(drawId);
    this.gameEventsGateway.emitKenoDrawCompleted(result);
    void this.kenoService.notifyDrawWinners(result.id).catch(() => undefined);
    return result;
  }

  @Post('draws/:id/cancel')
  cancelDraw(@Param('id') drawId: string) {
    return this.kenoService.cancelDraw(drawId);
  }
}
