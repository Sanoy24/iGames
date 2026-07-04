import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Operator } from './entities/operator.entity';
import { OperatorConfig } from './entities/operator-config.entity';
import { OperatorService } from './operator.service';

/**
 * Owns the tenant (Operator) and its per-operator configuration. Exports
 * OperatorService so Phase 1 tenant resolvers (JWT, host, Telegram) can map an
 * incoming request to an operatorId.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Operator, OperatorConfig])],
  providers: [OperatorService],
  exports: [OperatorService],
})
export class OperatorModule {}
