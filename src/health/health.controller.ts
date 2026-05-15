import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MongooseHealthIndicator
} from '@nestjs/terminus';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongooseIndicator: MongooseHealthIndicator
  ) {}

  @Get()
  @HealthCheck()
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        info: { mongodb: { status: 'up' } },
        error: {},
        details: { mongodb: { status: 'up' } }
      }
    }
  })
  check() {
    return this.health.check([
      () => this.mongooseIndicator.pingCheck('mongodb')
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
