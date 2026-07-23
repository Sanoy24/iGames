import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { PoolService } from './pool.service';

/** Public Pool endpoints. Phase 0 exposes read-only config for the client. */
@ApiTags('pool')
@SkipThrottle({ default: true })
@Controller('pool')
export class PoolController {
  constructor(private readonly poolService: PoolService) {}

  @Public()
  @Get('config')
  @ApiOkResponse({ description: 'Current Pool configuration (mode toggles, stakes, limits)' })
  getConfig() {
    return this.poolService.getConfig();
  }
}
