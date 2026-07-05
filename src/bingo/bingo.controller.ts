import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { AuthenticatedRequest, AuthenticatedUser } from '../auth/types/authenticated-user';
import { GameEventsGateway } from '../events/game-events.gateway';
import { PurchaseBingoTicketsDto } from './dto/purchase-bingo-tickets.dto';
import { BingoService } from './bingo.service';

@ApiTags('bingo')
@SkipThrottle({ default: true })
@Controller('bingo')
export class BingoController {
  constructor(
    private readonly bingoService: BingoService,
    private readonly gameEventsGateway: GameEventsGateway,
  ) {}

  @Get('rooms')
  listRooms() {
    return this.bingoService.listRooms();
  }

  @Get('current')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOkResponse({ description: 'The single active room (running → open → last completed) with the callers tickets' })
  getCurrentRoom(@Req() request: Request) {
    const maybeUser = (request as Partial<AuthenticatedRequest>).user;
    return this.bingoService.getCurrentRoom(maybeUser?.id);
  }

  @Get('rooms/:id/state')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  getRoomState(@Param('id') roomId: string, @Req() request: Request) {
    const maybeUser = (request as Partial<AuthenticatedRequest>).user;
    return this.bingoService.getRoomState({
      roomId,
      userId: maybeUser?.id
    });
  }

  @Get('rooms/:id/sync')
  @ApiBearerAuth()
  @UseGuards(OptionalJwtAuthGuard)
  syncRoomState(@Param('id') roomId: string, @Req() request: Request) {
    const maybeUser = (request as Partial<AuthenticatedRequest>).user;
    return this.bingoService.getRoomState({
      roomId,
      userId: maybeUser?.id
    });
  }

  @Get('rooms/:id/spectate')
  spectateRoom(@Param('id') roomId: string) {
    return this.bingoService.getSpectatorView(roomId);
  }

  @Post('rooms/:id/tickets')
  @Throttle({ strict: { ttl: 60_000, limit: 30 } })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({ description: 'Purchased bingo ticket(s)' })
  async purchaseTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') roomId: string,
    @Body() dto: PurchaseBingoTicketsDto,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const tickets = await this.bingoService.purchaseTickets({
      userId: user.id,
      roomId,
      count: dto.count,
      cartelaNumbers: dto.cartelaNumbers,
      idempotencyKey,
      selectedNumbers: dto.selectedNumbers,
    });

    // Emit room updated so other players see the new spot claimed in real-time.
    const roomState = await this.bingoService.getRoomState({ roomId });
    this.gameEventsGateway.emitBingoRoomUpdated(roomState);

    return tickets;
  }
}
