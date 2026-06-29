import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BotsService } from './bots.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { TopupBotDto, UpdateBotPolicyDto } from './dto/update-bot-policy.dto';

@ApiTags('admin-bots')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/bots')
export class BotsController {
  constructor(private readonly botsService: BotsService) {}

  @Post()
  @ApiOkResponse({ description: 'Creates a virtual user with a bot participation policy' })
  createBot(@Body() dto: CreateBotDto) {
    return this.botsService.createBot(dto);
  }

  @Get()
  @ApiOkResponse({ description: 'Lists all virtual users with their policies and wallet balances' })
  listBots() {
    return this.botsService.listBots();
  }

  @Patch(':id')
  @ApiOkResponse({ description: 'Updates the participation policy for a virtual user' })
  updatePolicy(@Param('id') id: string, @Body() dto: UpdateBotPolicyDto) {
    return this.botsService.updatePolicy(id, dto);
  }

  @Post(':id/topup')
  @ApiOkResponse({ description: 'Adds credits to a bot wallet' })
  topupBot(@Param('id') id: string, @Body() dto: TopupBotDto) {
    return this.botsService.topupBot(id, dto.amountMinor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOkResponse({ description: 'Deactivates and removes a bot from all game participation' })
  deleteBot(@Param('id') id: string) {
    return this.botsService.deleteBot(id);
  }
}
