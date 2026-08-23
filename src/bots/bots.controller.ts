import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BotsService } from './bots.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { BulkCreateBotDto, ImportBotsCsvDto } from './dto/bulk-create-bot.dto';
import { CreateBotNameDto, ImportBotNamesDto } from './dto/create-bot-name.dto';
import { TopupBotDto, UpdateBotPolicyDto } from './dto/update-bot-policy.dto';
import { UpdateBotNameDto } from './dto/update-bot-name.dto';

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

  @Post('bulk')
  @ApiCreatedResponse({ description: 'Creates many bots at once sharing one policy, auto-naming each from the bot name pool' })
  bulkCreateBots(@Body() dto: BulkCreateBotDto) {
    return this.botsService.bulkCreateBots(dto);
  }

  @Post('import-csv')
  @ApiCreatedResponse({ description: 'Bulk-creates bots from CSV text (header row incl. "displayName"; other CreateBotDto fields are optional columns)' })
  importBotsCsv(@Body() dto: ImportBotsCsvDto) {
    return this.botsService.importBotsCsv(dto.csv);
  }

  @Get()
  @ApiOkResponse({ description: 'Lists all virtual users with their policies and wallet balances' })
  listBots() {
    return this.botsService.listBots();
  }

  @Get('actions')
  @ApiOkResponse({ description: 'Lists recent bot activity and admin bot-management events' })
  listBotActions(
    @Query('botId') botId?: string,
    @Query('game') game?: 'keno' | 'bingo' | 'crash' | 'admin',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.botsService.listBotActions({
      botId,
      game,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('names')
  @ApiOkResponse({ description: 'Lists the active pool of Bingo bot names' })
  listBotNames() {
    return this.botsService.listBotNames();
  }

  @Patch(':id')
  @ApiOkResponse({ description: 'Updates the participation policy for a virtual user' })
  updatePolicy(@Param('id') id: string, @Body() dto: UpdateBotPolicyDto) {
    return this.botsService.updatePolicy(id, dto);
  }

  @Post('names')
  @ApiCreatedResponse({ description: 'Creates a single Bingo bot name' })
  createBotName(@Body() dto: CreateBotNameDto) {
    return this.botsService.createBotName(dto);
  }

  @Post('names/import')
  @ApiCreatedResponse({ description: 'Imports many Bingo bot names at once' })
  importBotNames(@Body() dto: ImportBotNamesDto) {
    return this.botsService.importBotNames(dto);
  }

  @Patch('names/:id')
  @ApiOkResponse({ description: 'Updates a Bingo bot name' })
  updateBotName(@Param('id') id: string, @Body() dto: UpdateBotNameDto) {
    return this.botsService.updateBotName(id, dto);
  }

  @Delete('names/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOkResponse({ description: 'Deletes a Bingo bot name' })
  deleteBotName(@Param('id') id: string) {
    return this.botsService.deleteBotName(id);
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
