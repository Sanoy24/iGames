import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { HealthController } from './health.controller';

@Module({
  imports: [
    TerminusModule,
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: {
        enabled: true
      }
    })
  ],
  controllers: [HealthController]
})
export class HealthModule {}
