import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PurchaseKenoTicketDto } from './dto/purchase-keno-ticket.dto';
import { KenoService } from './keno.service';

@ApiTags('keno')
@Controller('keno')
export class KenoController {
  constructor(private readonly kenoService: KenoService) {}

  @Get('config')
  @ApiOkResponse({
    schema: {
      example: {
        name: 'Default Keno',
        version: 1,
        numberMin: 1,
        numberMax: 80,
        drawSize: 20,
        allowedSpots: [1, 2, 3],
        ticketPriceMinor: 100
      }
    }
  })
  getConfig() {
    return this.kenoService.getActiveConfig();
  }

  @Post('tickets')
  @Throttle({ strict: { ttl: 60_000, limit: 10 } })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiCreatedResponse({
    schema: {
      example: {
        id: '665f...',
        drawId: '665f...',
        selectedNumbers: [1, 2, 3],
        stakeMinor: 100,
        status: 'pending'
      }
    }
  })
  purchaseTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PurchaseKenoTicketDto,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    return this.kenoService.purchaseTicket({
      userId: user.id,
      selectedNumbers: dto.selectedNumbers,
      idempotencyKey
    });
  }

  @Get('tickets')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  listTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number
  ) {
    return this.kenoService.listTicketsForUser({
      userId: user.id,
      limit
    });
  }

  @Get('tickets/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getTicket(@CurrentUser() user: AuthenticatedUser, @Param('id') ticketId: string) {
    return this.kenoService.getTicketForUser({
      userId: user.id,
      ticketId
    });
  }

  @Get('active-draw')
  getActiveDraw() {
    return this.kenoService.getActiveDraw();
  }

  @Get('draws/:id')
  getDraw(@Param('id') drawId: string) {
    return this.kenoService.getDraw(drawId);
  }

  @Get('draws')
  listDraws(@Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number) {
    return this.kenoService.listDraws({ limit });
  }
}
