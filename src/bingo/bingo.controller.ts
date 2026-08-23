import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    Param,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiOkResponse,
    ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
    AuthenticatedRequest,
    AuthenticatedUser,
} from '../auth/types/authenticated-user';
import { GameEventsGateway } from '../events/game-events.gateway';
import { PurchaseBingoTicketsDto } from './dto/purchase-bingo-tickets.dto';
import { SetBingoAutoDto } from './dto/set-bingo-auto.dto';
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
    listRooms(
        @Query('page') page: string = '1',
        @Query('limit') limit: string = '10',
    ) {
        return this.bingoService.listRooms({
            page: parseInt(page, 10) || 1,
            limit: Math.min(parseInt(limit, 10) || 10, 50),
        });
    }

    @Get('current')
    @ApiBearerAuth()
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOkResponse({
        description:
            'The single current room (running → recent completed result window → open) with the caller tickets',
    })
    getCurrentRoom(@Req() request: Request) {
        const maybeUser = (request as Partial<AuthenticatedRequest>).user;
        return this.bingoService.getCurrentRoom(maybeUser?.id);
    }

    @Get('lobby')
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOkResponse({
        description:
            'Joinable rooms + whether per-agent room mode is enabled (Approach B)',
    })
    getLobby(@Req() request: Request) {
        const maybeUser = (request as Partial<AuthenticatedRequest>).user;
        return this.bingoService.getLobby(maybeUser?.id);
    }

    @Get('rooms/:id/state')
    @ApiBearerAuth()
    @UseGuards(OptionalJwtAuthGuard)
    getRoomState(@Param('id') roomId: string, @Req() request: Request) {
        const maybeUser = (request as Partial<AuthenticatedRequest>).user;
        return this.bingoService.getRoomState({
            roomId,
            userId: maybeUser?.id,
        });
    }

    @Get('rooms/:id/sync')
    @ApiBearerAuth()
    @UseGuards(OptionalJwtAuthGuard)
    syncRoomState(@Param('id') roomId: string, @Req() request: Request) {
        const maybeUser = (request as Partial<AuthenticatedRequest>).user;
        return this.bingoService.getRoomState({
            roomId,
            userId: maybeUser?.id,
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
        @Headers('idempotency-key') idempotencyKey?: string,
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

    @Post('rooms/:id/auto')
    @Throttle({ strict: { ttl: 60_000, limit: 30 } })
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOkResponse({
        description:
            'Set the caller Auto preference for their cards in this room',
    })
    setAuto(
        @CurrentUser() user: AuthenticatedUser,
        @Param('id') roomId: string,
        @Body() dto: SetBingoAutoDto,
    ) {
        return this.bingoService.setAutoClaim({
            userId: user.id,
            roomId,
            auto: dto.auto,
        });
    }

    @Post('rooms/:id/tickets/:ticketId/claim')
    @Throttle({ strict: { ttl: 60_000, limit: 60 } })
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOkResponse({
        description: 'Manually call Bingo on a cartela (derash manual mode)',
    })
    async claimBingo(
        @CurrentUser() user: AuthenticatedUser,
        @Param('id') roomId: string,
        @Param('ticketId') ticketId: string,
    ) {
        const result = await this.bingoService.claimBingo({
            userId: user.id,
            roomId,
            ticketId,
        });

        // A successful claim changes the room result  push it to every client so the
        // board, winner card, and result overlay update in real-time.
        if (result.result === 'won') {
            const roomState = await this.bingoService.getRoomState({ roomId });
            this.gameEventsGateway.emitBingoRoomUpdated(roomState);
        }

        return result;
    }

    @Delete('rooms/:id/cartelas/:cartelaNumber')
    @Throttle({ strict: { ttl: 60_000, limit: 60 } })
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOkResponse({
        description:
            'Released a cartela and refunded its stake (sales window only)',
    })
    async releaseCartela(
        @CurrentUser() user: AuthenticatedUser,
        @Param('id') roomId: string,
        @Param('cartelaNumber') cartelaNumber: string,
    ) {
        const n = Number(cartelaNumber);
        if (!Number.isInteger(n) || n < 1) {
            throw new BadRequestException(
                'cartelaNumber must be a positive integer',
            );
        }

        const result = await this.bingoService.releaseCartela({
            userId: user.id,
            roomId,
            cartelaNumber: n,
        });

        // Emit room updated so every client sees the cartela freed in real-time.
        const roomState = await this.bingoService.getRoomState({ roomId });
        this.gameEventsGateway.emitBingoRoomUpdated(roomState);

        return result;
    }
}
