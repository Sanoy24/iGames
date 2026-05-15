import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GameEventsGateway } from '../events/game-events.gateway';
import { BingoService } from './bingo.service';
import { CreateBingoRoomDto } from './dto/create-bingo-room.dto';

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

  @Post('rooms')
  @ApiCreatedResponse({
    schema: { example: { id: '665f...', name: 'Daily 90-ball', status: 'open' } }
  })
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
