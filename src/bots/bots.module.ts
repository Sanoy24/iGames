import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BingoModule } from '../bingo/bingo.module';
import { CrashModule } from '../crash/crash.module';
import { KenoModule } from '../keno/keno.module';
import { User } from '../users/entities/user.entity';
import { WalletModule } from '../wallet/wallet.module';
import { AdminModule } from '../admin/admin.module';
import { BotsController } from './bots.controller';
import { BotsService } from './bots.service';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([User]),
    WalletModule,
    AdminModule,
    KenoModule,
    BingoModule,
    CrashModule,
  ],
  controllers: [BotsController],
  providers: [BotsService, JwtAuthGuard, RolesGuard],
  exports: [BotsService]
})
export class BotsModule {}
