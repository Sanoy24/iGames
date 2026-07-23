import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator
} from '@nestjs/terminus';
import { VERSION_INFO } from './version.info';

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

  @Get('version')
  @ApiOkResponse({
    schema: {
      example: {
        service: 'igames-backend',
        version: '0.1.0',
        gitCommit: 'e0fa893',
        gitBranch: 'migration/mysql',
        startedAt: '2026-07-03T12:00:00.000Z',
        uptimeSeconds: 1234,
        nodeEnv: 'production',
        now: '2026-07-03T12:20:34.000Z'
      }
    }
  })
  version() {
    return {
      ...VERSION_INFO,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeEnv: process.env.NODE_ENV ?? 'development',
      now: new Date().toISOString()
    };
  }
}
