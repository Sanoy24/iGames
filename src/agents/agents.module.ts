import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletModule } from '../wallet/wallet.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentShift } from './entities/agent-shift.entity';
import { UsersModule } from '../users/users.module';
import { SystemConfig } from '../admin/entities/system-config.entity';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([AgentShift, SystemConfig]),
    WalletModule,
    UsersModule,
  ],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService, TypeOrmModule],
})
export class AgentsModule {}
