import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GameEventsGateway } from '../events/game-events.gateway';
import { BingoService } from './bingo.service';
import { CreateBingoRoomDto } from './dto/create-bingo-room.dto';
import { UpdateBingoConfigDto } from './dto/update-bingo-config.dto';
import { CreateBingoPatternDto, UpdateBingoPatternDto } from './dto/create-bingo-pattern.dto';
import { UpdateRoomSlotDto } from './dto/update-room-slot.dto';

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

  /** Cosmetic-only: name and/or lobby card style. Any room, any status — see
   * BingoService.updateRoomDisplay for the agent-room "doesn't persist across
   * auto-recreation" caveat. */
  @Patch('rooms/:id/display')
  async updateRoomDisplay(
    @Param('id') roomId: string,
    @Body() dto: { name?: string; cardPaletteId?: string | null; cardBallNumber?: number | null },
  ) {
    const room = await this.bingoService.updateRoomDisplay(roomId, dto);
    this.gameEventsGateway.emitBingoRoomUpdated(room);
    return room;
  }

  // ── Room Slots (persistent per-slot label/palette/ball) ────────────

  /** House + every agent's auto-managed room slot, with its persistent style. */
  @Get('room-slots')
  @ApiOkResponse({ description: 'House + every agent room slot with its persistent label/palette/ball, applied on next auto-recreation.' })
  listRoomSlots() {
    return this.bingoService.listRoomSlots();
  }

  @Patch('room-slots/:ownerId')
  @ApiOkResponse({ description: "Updates a room slot's persistent label/palette/ball ('house' or an agent id) and applies it to that slot's live room immediately." })
  async updateRoomSlot(@Param('ownerId') ownerId: string, @Body() dto: UpdateRoomSlotDto) {
    const updatedLiveRoom = await this.bingoService.updateRoomSlot(ownerId, dto);
    if (updatedLiveRoom) this.gameEventsGateway.emitBingoRoomUpdated(updatedLiveRoom);
    return this.bingoService.listRoomSlots();
  }

  @Post('rooms/:id/draw-next')
  async drawNextNumber(@Param('id') roomId: string) {
    const room = await this.bingoService.drawNextNumber(roomId);
    const cfg = await this.bingoService.getBingoConfig();
    this.gameEventsGateway.emitBingoNumberDrawn(room, Math.max(1, cfg.drawIntervalSeconds ?? 2) * 1000);
    if (room.status === 'completed') {
      this.gameEventsGateway.emitBingoRoomCompleted(room);
      void this.bingoService.notifyRoomWinners(room.id).catch(() => undefined);
    }
    return room;
  }

  @Get('rooms/:id/details')
  @ApiOkResponse({ description: 'Full round detail for traceability: room, winners, and every cartela/card.' })
  getRoomDetails(@Param('id') roomId: string) {
    return this.bingoService.getRoomAdminDetails(roomId);
  }

  @Post('rooms/:id/cancel')
  async cancelRoom(@Param('id') roomId: string) {
    const room = await this.bingoService.cancelRoom(roomId);
    this.gameEventsGateway.emitBingoRoomUpdated(room);
    return room;
  }

  // ── Patterns ────────────────────────────────────────────────────

  @Get('patterns')
  @ApiOkResponse({ description: 'Returns all bingo patterns.' })
  listPatterns() {
    return this.bingoService.listPatterns();
  }

  @Post('patterns')
  @ApiOkResponse({ description: 'Creates a custom bingo pattern.' })
  createPattern(@Body() dto: CreateBingoPatternDto) {
    return this.bingoService.createPattern(dto);
  }

  @Patch('patterns/:id')
  @ApiOkResponse({ description: 'Updates a bingo pattern.' })
  updatePattern(@Param('id') id: string, @Body() dto: UpdateBingoPatternDto) {
    return this.bingoService.updatePattern(id, dto);
  }

  @Delete('patterns/:id')
  @ApiOkResponse({ description: 'Deletes a custom bingo pattern.' })
  deletePattern(@Param('id') id: string) {
    return this.bingoService.deletePattern(id);
  }

  @Post('patterns/seed')
  @ApiOkResponse({ description: 'Seeds built-in bingo patterns.' })
  seedPatterns() {
    return this.bingoService.seedBuiltInPatterns();
  }
}
