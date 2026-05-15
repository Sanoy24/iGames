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
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedRequest, AuthenticatedUser } from '../auth/types/authenticated-user';
import { PurchaseBingoTicketsDto } from './dto/purchase-bingo-tickets.dto';
import { BingoService } from './bingo.service';

@ApiTags('bingo')
@Controller('bingo')
export class BingoController {
  constructor(private readonly bingoService: BingoService) {}

  @Get('rooms')
  @ApiOkResponse({
    schema: {
      example: [
        {
          id: '665f...',
          name: 'Daily 90-ball',
          status: 'open',
          ticketPriceMinor: 100,
          soldTickets: 12
        }
      ]
    }
  })
  listRooms() {
    return this.bingoService.listRooms();
  }

  @Get('rooms/:id/state')
  getRoomState(@Param('id') roomId: string, @Req() request: Request) {
    const maybeUser = (request as Partial<AuthenticatedRequest>).user;
    return this.bingoService.getRoomState({
      roomId,
      userId: maybeUser?.id
    });
  }

  @Post('rooms/:id/tickets')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({
    schema: {
      example: [
        {
          id: '665f...',
          roomId: '665f...',
          grid: [[1, null, 20, null, 44, null, 61, null, 88]],
          status: 'active'
        }
      ]
    }
  })
  purchaseTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') roomId: string,
    @Body() dto: PurchaseBingoTicketsDto,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    return this.bingoService.purchaseTickets({
      userId: user.id,
      roomId,
      count: dto.count,
      idempotencyKey
    });
  }
}
