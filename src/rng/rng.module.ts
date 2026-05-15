import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RngAuditLog, RngAuditLogSchema } from './schemas/rng-audit-log.schema';
import { RngService } from './rng.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RngAuditLog.name, schema: RngAuditLogSchema }
    ])
  ],
  providers: [RngService],
  exports: [RngService, MongooseModule]
})
export class RngModule {}
