import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GamesModule } from '../games/games.module';
import { PoolConfig } from './entities/pool-config.entity';
import { PoolService } from './pool.service';
import { PoolController } from './pool.controller';
import { PoolAdminController } from './pool-admin.controller';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([PoolConfig]),
    GamesModule,
  ],
  controllers: [PoolController, PoolAdminController],
  providers: [PoolService, JwtAuthGuard, RolesGuard],
  exports: [PoolService],
})
export class PoolModule {}
