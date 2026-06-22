import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GameEventsGateway } from '../events/game-events.gateway';
import { BingoService } from './bingo.service';
import { CreateBingoRoomDto } from './dto/create-bingo-room.dto';
import { UpdateBingoConfigDto } from './dto/update-bingo-config.dto';

@ApiTags('admin-bingo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/bingo')
export class BingoAdminController {
  constructor(
    private readonly bingoService: BingoService,
    private readonly gameEventsGateway: GameEventsGateway
  ) {}

  // ── Config ──────────────────────────────────────────────────────

  @Get('config')
  @ApiOkResponse({ description: 'Returns the global Bingo auto-play configuration.' })
  getConfig() {
    return this.bingoService.getBingoConfig();
  }

  @Post('config')
  @ApiOkResponse({ description: 'Updates and returns the global Bingo configuration.' })
  updateConfig(@Body() dto: UpdateBingoConfigDto) {
    return this.bingoService.updateBingoConfig(dto);
  }

  // ── Rooms ───────────────────────────────────────────────────────

  @Post('rooms')
  async createRoom(@Body() dto: CreateBingoRoomDto) {
    const room = await this.bingoService.createRoom(dto);
    this.gameEventsGateway.emitBingoRoomUpdated(room);
    return room;
  }

  @Post('rooms/:id/draw-next')
  async drawNextNumber(@Param('id') roomId: string) {
    const room = await this.bingoService.drawNextNumber(roomId);
    this.gameEventsGateway.emitBingoNumberDrawn(room);
    if (room.status === 'completed') {
      this.gameEventsGateway.emitBingoRoomCompleted(room);
    }
    return room;
  }

  @Post('rooms/:id/cancel')
  async cancelRoom(@Param('id') roomId: string) {
    const room = await this.bingoService.cancelRoom(roomId);
    this.gameEventsGateway.emitBingoRoomUpdated(room);
    return room;
  }
}
