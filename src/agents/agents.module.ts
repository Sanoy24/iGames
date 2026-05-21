import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { WalletModule } from '../wallet/wallet.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentShift, AgentShiftSchema } from './schemas/agent-shift.schema';

@Module({
  imports: [
    JwtModule.register({}),
    MongooseModule.forFeature([{ name: AgentShift.name, schema: AgentShiftSchema }]),
    WalletModule,
  ],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
