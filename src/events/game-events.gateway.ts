import { Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer, SubscribeMessage } from '@nestjs/websockets';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { KenoDrawResponse } from '../keno/keno.service';
import { BingoRoomResponse } from '../bingo/bingo.service';
import { WalletSummary } from '../wallet/wallet.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { User } from '../users/entities/user.entity';

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

export type WithdrawalPendingPayload = {
  withdrawalId: string;
  userId: string;
  amountMinor: number;
  destinationAccount: string;
};

export type CrashRoundPayload = {
  roundId: string;
  status: string;
  seedHash: string;
  elapsedMs?: number;
  crashPointX100?: number | null;
};

export type CrashTickPayload = {
  roundId: string;
  multiplierX100: number;
  elapsedMs: number;
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
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationShutdown(signal?: string) {
    this.logger.warn(`Application shutting down via ${signal}. Broadcasting system.maintenance event.`);
    this.server.emit('system.maintenance', { message: 'System is shutting down for maintenance or scaling.' });
    this.server.disconnectSockets();
  }

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

      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        select: ['id', 'status', 'roles', 'displayName']
      });

      if (!user || user.status !== 'active') {
        throw new Error('Account is not active');
      }

      client.data.user = payload;
      client.data.displayName = user.displayName ?? 'Player';
      await client.join(`user_${payload.sub}`);

      // Agents join a shared room so withdrawal.pending broadcasts reach them all.
      if (Array.isArray(user.roles) && user.roles.includes('agent')) {
        await client.join('agents');
      }

      this.logger.debug(`Client connected: ${client.id} (User: ${payload.sub}, roles: ${(user.roles as string[]).join(',')})`);
      await this.broadcastLiveCounts();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unauthorized WebSocket connection attempt: ${client.id} - ${message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
    void this.broadcastLiveCounts();
  }

  getLiveCounts() {
    const socketMap = this.server?.sockets.sockets;
    const getDistinctUsers = (roomName?: string) => {
      const socketIds = roomName
        ? Array.from(this.server?.sockets.adapter.rooms.get(roomName) ?? [])
        : Array.from(socketMap?.keys() ?? []);
      const users = new Set<string>();
      for (const socketId of socketIds) {
        const socket = socketMap?.get(socketId);
        const userId = socket?.data?.user?.sub;
        if (typeof userId === 'string' && userId) {
          users.add(userId);
        }
      }
      return users;
    };

    const kenoUsers = getDistinctUsers('game_keno');
    const bingoUsers = getDistinctUsers('game_bingo');
    const crashUsers = getDistinctUsers('game_crash');
    const totalUsers = getDistinctUsers();
    const playingUsers = new Set<string>([...kenoUsers, ...bingoUsers, ...crashUsers]);

    return {
      kenoOnline: kenoUsers.size,
      bingoOnline: bingoUsers.size,
      totalOnline: totalUsers.size,
      totalPlaying: playingUsers.size,
      totalConnections: socketMap?.size || 0,
    };
  }

  async broadcastLiveCounts() {
    const counts = this.getLiveCounts();
    this.server?.emit('live.counts', counts);
  }

  /**
   * Periodic refresh so counts stay correct cluster-wide even if a
   * connect/disconnect event was missed, and so freshly opened tabs converge.
   */
  @Interval(10_000)
  handleLiveCountsHeartbeat() {
    void this.broadcastLiveCounts();
  }

  /** On-demand pull — clients emit this on connect to populate counts immediately. */
  @SubscribeMessage('request.counts')
  handleRequestCounts(client: Socket) {
    client.emit('live.counts', this.getLiveCounts());
  }

  @SubscribeMessage('enter.game')
  async handleEnterGame(client: Socket, payload: { game: 'keno' | 'bingo' | 'crash' }) {
    if (payload?.game === 'keno') {
      await client.join('game_keno');
      this.logger.debug(`Client ${client.id} entered Keno`);
    } else if (payload?.game === 'bingo') {
      await client.join('game_bingo');
      this.logger.debug(`Client ${client.id} entered Bingo`);
    } else if (payload?.game === 'crash') {
      await client.join('game_crash');
      this.logger.debug(`Client ${client.id} entered Crash`);
    }
    await this.broadcastLiveCounts();
  }

  @SubscribeMessage('leave.game')
  async handleLeaveGame(client: Socket, payload: { game: 'keno' | 'bingo' | 'crash' }) {
    if (payload?.game === 'keno') {
      await client.leave('game_keno');
      this.logger.debug(`Client ${client.id} left Keno`);
    } else if (payload?.game === 'bingo') {
      await client.leave('game_bingo');
      this.logger.debug(`Client ${client.id} left Bingo`);
    } else if (payload?.game === 'crash') {
      await client.leave('game_crash');
      this.logger.debug(`Client ${client.id} left Crash`);
    }
    await this.broadcastLiveCounts();
  }

  emitWalletUpdated(userId: string, wallet: WalletSummary): void {
    this.server.to(`user_${userId}`).emit('wallet.updated', wallet);
  }

  /** Notify all connected agents that a new withdrawal is waiting. */
  emitWithdrawalPending(payload: WithdrawalPendingPayload): void {
    this.server.to('agents').emit('withdrawal.pending', payload);
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

  emitCrashRoundWaiting(payload: CrashRoundPayload): void {
    this.server.emit('crash.round.waiting', payload);
  }

  emitCrashRoundStarted(payload: CrashRoundPayload): void {
    this.server.emit('crash.round.started', payload);
  }

  emitCrashTick(payload: CrashTickPayload): void {
    this.server.emit('crash.tick', payload);
  }

  emitCrashRoundCrashed(payload: CrashRoundPayload & { seed: string }): void {
    this.server.emit('crash.round.crashed', payload);
  }

  emitCrashBetPlaced(userId: string, payload: Record<string, unknown>): void {
    this.server.to(`user_${userId}`).emit('crash.bet.placed', payload);
  }

  emitCrashCashedOut(userId: string, payload: Record<string, unknown>): void {
    this.server.to(`user_${userId}`).emit('crash.bet.cashedout', payload);
  }

  @SubscribeMessage('enter.crash')
  async handleEnterCrash(client: Socket) {
    await client.join('game_crash');
  }

  @SubscribeMessage('leave.crash')
  async handleLeaveCrash(client: Socket) {
    await client.leave('game_crash');
  }

  @SubscribeMessage('bingo.chat.send')
  handleBingoChatSend(client: Socket, payload: { roomId: string; text: string }) {
    if (!payload?.roomId || typeof payload.text !== 'string') return;
    const text = payload.text.trim().slice(0, 200);
    if (!text) return;

    const userId: string = client.data.user?.sub ?? '';
    const displayName: string = client.data.displayName ?? 'Player';

    this.server.to('game_bingo').emit('bingo.chat.message', {
      roomId: payload.roomId,
      userId,
      displayName,
      text,
      timestamp: new Date().toISOString(),
    });
  }
}
