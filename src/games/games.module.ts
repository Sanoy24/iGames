import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GameEventsModule } from '../events/game-events.module';
import { GameSetting } from './entities/game-setting.entity';
import { GamesService } from './games.service';
import { GamesController } from './games.controller';
import { GamesAdminController } from './games-admin.controller';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([GameSetting]),
    GameEventsModule,
  ],
  controllers: [GamesController, GamesAdminController],
  providers: [GamesService, JwtAuthGuard, RolesGuard],
  exports: [GamesService],
})
export class GamesModule {}
