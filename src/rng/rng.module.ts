import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RngAuditLog } from './entities/rng-audit-log.entity';
import { RngService } from './rng.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RngAuditLog])
  ],
  providers: [RngService],
  exports: [RngService, TypeOrmModule]
})
export class RngModule {}
