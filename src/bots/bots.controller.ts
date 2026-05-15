import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BotsService } from './bots.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { UpdateBotPolicyDto } from './dto/update-bot-policy.dto';

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
  @ApiOkResponse({ description: 'Lists all virtual users and their policies' })
  listBots() {
    return this.botsService.listBots();
  }

  @Patch(':id')
  @ApiOkResponse({ description: 'Updates the participation policy for a virtual user' })
  updatePolicy(@Param('id') id: string, @Body() dto: UpdateBotPolicyDto) {
    return this.botsService.updatePolicy(id, dto);
  }
}
