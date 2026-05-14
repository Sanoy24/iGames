import { Module } from '@nestjs/common';
import { GameEventsGateway } from './game-events.gateway';

@Module({
  providers: [GameEventsGateway],
  exports: [GameEventsGateway]
})
export class GameEventsModule {}
