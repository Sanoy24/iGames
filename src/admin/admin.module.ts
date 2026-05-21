import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { SystemConfig, SystemConfigSchema } from './schemas/system-config.schema';
import { AgentsModule } from '../agents/agents.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SystemConfig.name, schema: SystemConfigSchema }]),
    JwtModule.register({}),
    UsersModule,
    WalletModule,
    AgentsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
