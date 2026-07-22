import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameEventsGateway } from './game-events.gateway';
import { PresenceService } from './presence.service';
import { User } from '../users/entities/user.entity';
import { PoolQueueEntry } from '../pool/entities/pool-queue-entry.entity';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([User, PoolQueueEntry])
  ],
  providers: [GameEventsGateway, PresenceService],
  exports: [GameEventsGateway, TypeOrmModule]
})
export class GameEventsModule {}
