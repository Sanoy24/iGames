import { Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { InjectConnection } from '@nestjs/mongoose';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import { Connection, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { KenoDrawResponse } from '../keno/keno.service';
import { BingoRoomResponse } from '../bingo/bingo.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

export type KenoDrawStartedPayload = {
  drawId: string;
  scheduledAt: Date;
  configVersion: number;
};

export type KenoDrawCompletedPayload = {
  drawId: string;
  drawnNumbers: number[];
  settlementSummary: Record<string, unknown>;
};

export type BingoRoomUpdatedPayload = {
  roomId: string;
  status: string;
  soldTickets: number;
  scheduledStartAt: Date;
};

export type BingoNumberDrawnPayload = {
  roomId: string;
  number: number;
  drawIndex: number;
  totalDrawn: number;
};

export type BingoRoomCompletedPayload = {
  roomId: string;
  drawnNumbers: number[];
  winnersByTier: Record<string, string[]>;
  settlementSummary: Record<string, unknown>;
};

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class GameEventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(GameEventsGateway.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: IORedis,
    @InjectConnection() private readonly connection: Connection,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationShutdown(signal?: string) {
    this.logger.warn(`Application shutting down via ${signal}. Broadcasting system.maintenance event.`);
    this.server.emit('system.maintenance', { message: 'System is shutting down for maintenance or scaling.' });
    this.server.disconnectSockets();
  }

  /**
   * After the Socket.IO server is initialized, attach the Redis pub/sub
   * adapter so events are broadcast across ALL backend instances.
   */
  afterInit(server: Server) {
    const pubClient = this.redisClient;
    const subClient = pubClient.duplicate();
    server.adapter(createAdapter(pubClient, subClient));
    this.logger.log('Socket.IO Redis adapter attached — WebSocket events are now cluster-aware.');
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (!token) {
        throw new Error('No token provided');
      }

      const secret = this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
      const payload = await this.jwtService.verifyAsync(token, { secret });

      if (!payload.sub) {
        throw new Error('Token payload missing sub');
      }

      const user = await this.connection
        .collection('users')
        .findOne(
          { _id: new Types.ObjectId(payload.sub) },
          { projection: { status: 1 } },
        );

      if (!user || user.status !== 'active') {
        throw new Error('Account is not active');
      }

      client.data.user = payload;
      await client.join(`user_${payload.sub}`);
      this.logger.debug(`Client authenticated & connected: ${client.id} (User: ${payload.sub})`);
    } catch (error) {
      const err = error as Error;
      this.logger.warn(`Unauthorized WebSocket connection attempt: ${client.id} - ${err.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  emitWalletUpdated(userId: string, wallet: any): void {
    this.server.to(`user_${userId}`).emit('wallet.updated', wallet);
  }

  emitKenoDrawStarted(payload: KenoDrawStartedPayload): void {
    this.server.emit('keno.draw.started', payload);
  }

  emitKenoDrawCompleted(draw: KenoDrawResponse): void {
    const payload: KenoDrawCompletedPayload = {
      drawId: draw.id,
      drawnNumbers: draw.drawnNumbers,
      settlementSummary: draw.settlementSummary
    };
    this.server.emit('keno.draw.completed', payload);
  }

  emitBingoRoomUpdated(room: BingoRoomResponse): void {
    const payload: BingoRoomUpdatedPayload = {
      roomId: room.id,
      status: room.status,
      soldTickets: room.soldTickets,
      scheduledStartAt: room.scheduledStartAt
    };
    this.server.emit('bingo.room.updated', payload);
  }

  emitBingoNumberDrawn(room: BingoRoomResponse): void {
    const drawnNumbers = room.drawnNumbers;
    const latestNumber = drawnNumbers[drawnNumbers.length - 1];
    if (latestNumber === undefined) return;

    const payload: BingoNumberDrawnPayload = {
      roomId: room.id,
      number: latestNumber,
      drawIndex: drawnNumbers.length - 1,
      totalDrawn: drawnNumbers.length
    };
    this.server.emit('bingo.number.drawn', payload);
  }

  emitBingoRoomCompleted(room: BingoRoomResponse): void {
    const payload: BingoRoomCompletedPayload = {
      roomId: room.id,
      drawnNumbers: room.drawnNumbers,
      winnersByTier: room.winnersByTier,
      settlementSummary: room.settlementSummary
    };
    this.server.emit('bingo.room.completed', payload);
  }
}
