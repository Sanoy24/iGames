import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator
} from '@nestjs/terminus';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator
  ) {}

  @Get()
  @HealthCheck()
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } }
      }
    }
  })
  check() {
    return this.health.check([
      () => this.db.pingCheck('database')
    ]);
  }

  @Get('ping')
  @ApiOkResponse({ schema: { example: { status: 'ok', uptime: 1234 } } })
  ping() {
    return {
      status: 'ok',
      service: 'igames-backend',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }
}
