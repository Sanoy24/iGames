import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GamesService } from './games.service';

/** Public game catalog — used by the client to decide which games to show. */
@ApiTags('games')
@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get('catalog')
  getCatalog() {
    return this.gamesService.getPublicCatalog();
  }
}
