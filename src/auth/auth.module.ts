import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramModule } from '../telegram/telegram.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminModule } from '../admin/admin.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshSession } from './entities/refresh-session.entity';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([RefreshSession]),
    TelegramModule,
    UsersModule,
    WalletModule,
    AdminModule
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService]
})
export class AuthModule {}
