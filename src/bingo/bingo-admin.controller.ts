import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GameEventsGateway } from '../events/game-events.gateway';
import { BingoService } from './bingo.service';
import { CreateBingoRoomDto } from './dto/create-bingo-room.dto';
import { UpdateBingoConfigDto } from './dto/update-bingo-config.dto';
import {
    CreateBingoPatternDto,
    UpdateBingoPatternDto,
} from './dto/create-bingo-pattern.dto';
import {
    CreateBingoBonusCampaignDto,
    UpdateBingoBonusCampaignDto,
} from './dto/create-bingo-bonus-campaign.dto';
import { UpdateRoomSlotDto } from './dto/update-room-slot.dto';
import { CreateCustomRoomSlotDto } from './dto/create-custom-room-slot.dto';
import { UpdateCustomRoomSlotDto } from './dto/update-custom-room-slot.dto';

@ApiTags('admin-bingo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/bingo')
export class BingoAdminController {
    constructor(
        private readonly bingoService: BingoService,
        private readonly gameEventsGateway: GameEventsGateway,
    ) {}

    // ── Config ──────────────────────────────────────────────────────

    @Get('config')
    @ApiOkResponse({
        description: 'Returns the global Bingo auto-play configuration.',
    })
    getConfig() {
        return this.bingoService.getBingoConfig();
    }

    @Post('config')
    @ApiOkResponse({
        description: 'Updates and returns the global Bingo configuration.',
    })
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

    /** Cosmetic-only: name and/or lobby card style. Any room, any status  see
     * BingoService.updateRoomDisplay for the agent-room "doesn't persist across
     * auto-recreation" caveat. */
    @Patch('rooms/:id/display')
    async updateRoomDisplay(
        @Param('id') roomId: string,
        @Body()
        dto: {
            name?: string;
            cardPaletteId?: string | null;
            cardBallNumber?: number | null;
        },
    ) {
        const room = await this.bingoService.updateRoomDisplay(roomId, dto);
        this.gameEventsGateway.emitBingoRoomUpdated(room);
        return room;
    }

    // ── Room Slots (persistent per-slot label/palette/ball) ────────────

    /** House + every agent's auto-managed room slot, with its persistent style. */
    @Get('room-slots')
    @ApiOkResponse({
        description:
            'House + every agent room slot with its persistent label/palette/ball, applied on next auto-recreation.',
    })
    listRoomSlots() {
        return this.bingoService.listRoomSlots();
    }

    @Patch('room-slots/:ownerId')
    @ApiOkResponse({
        description:
            "Updates a room slot's persistent label/palette/ball ('house' or an agent id) and applies it to that slot's live room immediately.",
    })
    async updateRoomSlot(
        @Param('ownerId') ownerId: string,
        @Body() dto: UpdateRoomSlotDto,
    ) {
        const updatedLiveRoom = await this.bingoService.updateRoomSlot(
            ownerId,
            dto,
        );
        if (updatedLiveRoom)
            this.gameEventsGateway.emitBingoRoomUpdated(updatedLiveRoom);
        return this.bingoService.listRoomSlots();
    }

    // ── Custom Room Slots (persistent, independently-named admin rooms) ─

    /** Every persistent custom room slot, with a snapshot of its current live room. */
    @Get('room-slots/custom')
    @ApiOkResponse({
        description:
            'Every persistent custom room slot, with its currently live room (if any).',
    })
    listCustomRoomSlots() {
        return this.bingoService.listCustomRoomSlots();
    }

    @Post('room-slots/custom')
    @ApiOkResponse({
        description:
            'Creates a persistent custom room slot and spawns its first live room.',
    })
    async createCustomRoomSlot(@Body() dto: CreateCustomRoomSlotDto) {
        const { slot, room } =
            await this.bingoService.createCustomRoomSlot(dto);
        if (room) this.gameEventsGateway.emitBingoRoomUpdated(room);
        return slot;
    }

    @Patch('room-slots/custom/:id')
    @ApiOkResponse({
        description:
            "Updates a custom room slot's persistent settings and applies non-retroactive fields to its live room immediately.",
    })
    async updateCustomRoomSlot(
        @Param('id') id: string,
        @Body() dto: UpdateCustomRoomSlotDto,
    ) {
        const { room } = await this.bingoService.updateCustomRoomSlot(id, dto);
        if (room) this.gameEventsGateway.emitBingoRoomUpdated(room);
        return this.bingoService.listCustomRoomSlots();
    }

    @Delete('room-slots/custom/:id')
    @ApiOkResponse({
        description:
            'Deletes a custom room slot. Its live room (if any) finishes normally and is not recreated.',
    })
    async deleteCustomRoomSlot(@Param('id') id: string) {
        await this.bingoService.deleteCustomRoomSlot(id);
        return this.bingoService.listCustomRoomSlots();
    }

    @Post('rooms/:id/draw-next')
    async drawNextNumber(@Param('id') roomId: string) {
        const room = await this.bingoService.drawNextNumber(roomId);
        const cfg = await this.bingoService.getBingoConfig();
        this.gameEventsGateway.emitBingoNumberDrawn(
            room,
            Math.max(1, cfg.drawIntervalSeconds ?? 2) * 1000,
        );
        if (room.status === 'completed') {
            this.gameEventsGateway.emitBingoRoomCompleted(room);
            void this.bingoService
                .notifyRoomWinners(room.id)
                .catch(() => undefined);
            // A manual admin-triggered draw can also be the one that finishes a room
            // the scheduler's own completion handling never runs for this path, so
            // referral commission must be settled here too.
            void this.bingoService
                .settleReferralCommission(room.id)
                .catch(() => undefined);
        }
        return room;
    }

    @Get('rooms/:id/details')
    @ApiOkResponse({
        description:
            'Full round detail for traceability: room, winners, and every cartela/card.',
    })
    getRoomDetails(@Param('id') roomId: string) {
        return this.bingoService.getRoomAdminDetails(roomId);
    }

    /** Rooms that are 'running' but haven't successfully drawn in a while  see
     * BingoService.findStalledRunningRooms for what "stopped progressing" means. */
    @Get('rooms/stalled')
    @ApiOkResponse({
        description:
            'Running rooms whose draw has stopped making progress (a repeatedly-failing draw, etc).',
    })
    async listStalledRooms() {
        const cfg = await this.bingoService.getBingoConfig();
        const thresholdSeconds = Math.max(
            20,
            5 * Math.max(1, cfg.drawIntervalSeconds ?? 2),
        );
        return this.bingoService.findStalledRunningRooms(thresholdSeconds);
    }

    /** Recent operational alerts (misconfiguration/failure traces that would
     * otherwise only be visible in server logs). */
    @Get('alerts')
    @ApiOkResponse({
        description: 'Recent Bingo operational alerts, most-recent-first.',
    })
    listAlerts() {
        return this.bingoService.listOperationalAlerts();
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

    // ── Bonus Campaigns ────────────────────────────────────────────────

    @Get('bonus-campaigns')
    @ApiOkResponse({ description: 'Returns all Bingo bonus win campaigns.' })
    listBonusCampaigns() {
        return this.bingoService.listBonusCampaigns();
    }

    @Post('bonus-campaigns')
    @ApiOkResponse({ description: 'Creates a Bingo bonus win campaign.' })
    createBonusCampaign(@Body() dto: CreateBingoBonusCampaignDto) {
        return this.bingoService.createBonusCampaign(dto);
    }

    @Patch('bonus-campaigns/:id')
    @ApiOkResponse({ description: 'Updates a Bingo bonus win campaign.' })
    updateBonusCampaign(
        @Param('id') id: string,
        @Body() dto: UpdateBingoBonusCampaignDto,
    ) {
        return this.bingoService.updateBonusCampaign(id, dto);
    }

    @Delete('bonus-campaigns/:id')
    @ApiOkResponse({ description: 'Deletes a Bingo bonus win campaign.' })
    deleteBonusCampaign(@Param('id') id: string) {
        return this.bingoService.deleteBonusCampaign(id);
    }
}
