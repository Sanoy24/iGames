import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { GameEventsGateway } from './game-events.gateway';

@Module({
  imports: [JwtModule.register({})],
  providers: [GameEventsGateway],
  exports: [GameEventsGateway]
})
export class GameEventsModule {}
