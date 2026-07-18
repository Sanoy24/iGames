import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GamesModule } from '../games/games.module';
import { RngModule } from '../rng/rng.module';
import { PoolConfig } from './entities/pool-config.entity';
import { PoolMatch } from './entities/pool-match.entity';
import { PoolShot } from './entities/pool-shot.entity';
import { PoolService } from './pool.service';
import { PoolMatchService } from './pool-match.service';
import { PoolController } from './pool.controller';
import { PoolAdminController } from './pool-admin.controller';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([PoolConfig, PoolMatch, PoolShot]),
    GamesModule,
    RngModule,
  ],
  controllers: [PoolController, PoolAdminController],
  providers: [PoolService, PoolMatchService, JwtAuthGuard, RolesGuard],
  exports: [PoolService, PoolMatchService],
})
export class PoolModule {}
