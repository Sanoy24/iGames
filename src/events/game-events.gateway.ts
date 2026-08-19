import { Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
} from '@nestjs/websockets';
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
import { PoolQueueEntry } from '../pool/entities/pool-queue-entry.entity';
import { PresenceService } from './presence.service';

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
    scheduledStartAt: Date | null;
};

export type BingoNumberDrawnPayload = {
    roomId: string;
    number: number;
    drawIndex: number;
    totalDrawn: number;
    // Carried on every draw so clients can announce a place the instant it is won
    // (derash), rather than only learning the winners at room completion.
    winnersByTier: Record<string, string[]>;
    settlementSummary: Record<string, unknown>;
    // Server clock at emit time and the configured cadence, so the client can pace
    // its reveal animation off the server's actual interval instead of a hardcoded
    // guess that can outrun it and stall waiting for the next socket event.
    emittedAt: number;
    intervalMs: number;
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
    implements
        OnGatewayInit,
        OnGatewayConnection,
        OnGatewayDisconnect,
        OnApplicationShutdown
{
    @WebSocketServer()
    private readonly server: Server;

    private readonly logger = new Logger(GameEventsGateway.name);

    constructor(
        @Inject(REDIS_CLIENT) private readonly redisClient: IORedis,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(PoolQueueEntry)
        private readonly poolQueueRepo: Repository<PoolQueueEntry>,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly presenceService: PresenceService,
    ) {}

    async onApplicationShutdown(signal?: string) {
        this.logger.warn(
            `Application shutting down via ${signal}. Broadcasting system.maintenance event.`,
        );
        this.server.emit('system.maintenance', {
            message: 'System is shutting down for maintenance or scaling.',
        });
        this.server.disconnectSockets();
    }

    afterInit(server: Server) {
        const pubClient = this.redisClient;
        const subClient = pubClient.duplicate();
        server.adapter(createAdapter(pubClient, subClient));
        this.logger.log(
            'Socket.IO Redis adapter attached  WebSocket events are now cluster-aware.',
        );
    }

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth?.token;
            if (!token) {
                throw new Error('No token provided');
            }

            const secret =
                this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
            const payload = await this.jwtService.verifyAsync(token, {
                secret,
            });

            if (!payload.sub) {
                throw new Error('Token payload missing sub');
            }

            const user = await this.userRepository.findOne({
                where: { id: payload.sub },
                select: [
                    'id',
                    'status',
                    'roles',
                    'displayName',
                    'phoneNumber',
                    'createdAt',
                ],
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

            // Admins join a shared room so player-activity alerts (below) reach every
            // open admin panel tab at once, the same way agent broadcasts do above.
            if (Array.isArray(user.roles) && user.roles.includes('admin')) {
                await client.join('admins');
            }

            // A player (not an agent/admin backoffice login) opening the Mini App
            // notify every connected admin panel in real time so an admin watching
            // the dashboard can react live, not just from the players list. Fires on
            // every connect, including reconnects  deliberately not throttled, since
            // an admin who wants a quieter signal can just mute the alert client-side.
            if (Array.isArray(user.roles) && user.roles.includes('player')) {
                // Cached on the socket so the app.opened re-foreground signal below
                // (which fires without a fresh connect/DB lookup) can reuse it.
                client.data.playerAlertInfo = {
                    userId: user.id,
                    displayName: user.displayName ?? 'Player',
                    phoneNumber: user.phoneNumber ?? null,
                    createdAt: user.createdAt,
                };
                this.emitPlayerOpenedAlert(client.data.playerAlertInfo);
            }

            this.logger.debug(
                `Client connected: ${client.id} (User: ${payload.sub}, roles: ${(user.roles as string[]).join(',')})`,
            );
            await this.broadcastLiveCounts();
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            this.logger.warn(
                `Unauthorized WebSocket connection attempt: ${client.id} - ${message}`,
            );
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        this.logger.debug(`Client disconnected: ${client.id}`);
        void this.broadcastLiveCounts();
    }

    /** Distinct user IDs with at least one live socket connection right now (room-scoped when given). */
    private getDistinctUsers(roomName?: string): Set<string> {
        const socketMap = this.server?.sockets.sockets;
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
    }

    /** Currently-connected user IDs  lets admin views flag a player "online" right now. */
    getOnlineUserIds(): Set<string> {
        return this.getDistinctUsers();
    }

    getLiveCounts() {
        const kenoUsers = this.getDistinctUsers('game_keno');
        const bingoUsers = this.getDistinctUsers('game_bingo');
        const crashUsers = this.getDistinctUsers('game_crash');
        const totalUsers = this.getDistinctUsers();
        const playingUsers = new Set<string>([
            ...kenoUsers,
            ...bingoUsers,
            ...crashUsers,
        ]);

        return {
            kenoOnline: kenoUsers.size,
            bingoOnline: bingoUsers.size,
            crashOnline: crashUsers.size,
            totalOnline: totalUsers.size,
            totalPlaying: playingUsers.size,
            totalConnections: this.server?.sockets.sockets.size || 0,
        };
    }

    /**
     * Real socket counts (above) MERGED with house bot presence so the numbers shown
     * to players include bots  per game (participating bots) and total (all active
     * bots are "online"). The raw `bots` breakdown is included for the admin panel.
     */
    async getLiveCountsWithBots() {
        const real = this.getLiveCounts();
        const bots = await this.presenceService.getBotCounts().catch(() => ({
            kenoBots: 0,
            bingoBots: 0,
            crashBots: 0,
            totalBots: 0,
        }));
        // Players actively waiting in the two-player Pool queue. DB-sourced (shared
        // across instances) so any node's heartbeat reports the true figure. Powers
        // the Home "someone's waiting for a Pool match" banner.
        const poolWaiting = await this.poolQueueRepo.count().catch(() => 0);
        return {
            kenoOnline: real.kenoOnline + bots.kenoBots,
            bingoOnline: real.bingoOnline + bots.bingoBots,
            crashOnline: real.crashOnline + bots.crashBots,
            // Total online = real distinct users online + every active bot (bots count as online).
            totalOnline: real.totalOnline + bots.totalBots,
            // Playing = real players in a game + bots participating in a game.
            totalPlaying:
                real.totalPlaying +
                bots.kenoBots +
                bots.bingoBots +
                bots.crashBots,
            totalConnections: real.totalConnections,
            poolWaiting,
            bots,
        };
    }

    async broadcastLiveCounts() {
        const counts = await this.getLiveCountsWithBots();
        this.server?.emit('live.counts', counts);
    }

    private emitPlayerOpenedAlert(info: {
        userId: string;
        displayName: string;
        phoneNumber: string | null;
        createdAt: Date;
    }): void {
        this.server.to('admins').emit('admin.player_connected', {
            userId: info.userId,
            displayName: info.displayName,
            phoneNumber: info.phoneNumber,
            isNewPlayer:
                Date.now() - new Date(info.createdAt).getTime() < 60_000,
            timestamp: Date.now(),
        });
    }

    /**
     * Client-reported "the Mini App is back in front"  covers the case where
     * Telegram freezes rather than destroys the WebView on close, so the
     * underlying socket transport can still look connected to the client when
     * the player reopens (handleConnection above never re-fires because there
     * is no new connection). See useSocketConnection.ts's onForeground, which
     * emits this only when it did NOT need to reconnect the socket  a real
     * reconnect already re-triggers handleConnection's own alert, so emitting
     * here too would double the ding.
     */
    @SubscribeMessage('player.app_opened')
    handlePlayerAppOpened(client: Socket): void {
        const info = client.data.playerAlertInfo as
            | {
                  userId: string;
                  displayName: string;
                  phoneNumber: string | null;
                  createdAt: Date;
              }
            | undefined;
        if (!info) return; // not a player connection, or not authenticated yet
        this.emitPlayerOpenedAlert(info);
    }

    /**
     * Periodic refresh so counts stay correct cluster-wide even if a
     * connect/disconnect event was missed, and so freshly opened tabs converge.
     */
    @Interval(10_000)
    handleLiveCountsHeartbeat() {
        void this.broadcastLiveCounts();
    }

    /** On-demand pull  clients emit this on connect to populate counts immediately. */
    @SubscribeMessage('request.counts')
    async handleRequestCounts(client: Socket) {
        client.emit('live.counts', await this.getLiveCountsWithBots());
    }

    @SubscribeMessage('enter.game')
    async handleEnterGame(
        client: Socket,
        payload: { game: 'keno' | 'bingo' | 'crash' },
    ) {
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
    async handleLeaveGame(
        client: Socket,
        payload: { game: 'keno' | 'bingo' | 'crash' },
    ) {
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

    /** Push a durable notification live to a single user's socket room (bell). */
    emitUserNotification(
        userId: string,
        payload: Record<string, unknown>,
    ): void {
        this.server.to(`user_${userId}`).emit('notification.new', payload);
    }

    /** Notify all connected agents that a new withdrawal is waiting. */
    emitWithdrawalPending(payload: WithdrawalPendingPayload): void {
        this.server.to('agents').emit('withdrawal.pending', payload);
    }

    /** Broadcast the updated public game catalog so clients hide/reveal games live. */
    emitGamesCatalogUpdated(catalog: unknown): void {
        this.server.emit('games.catalog.updated', catalog);
    }

    emitKenoDrawStarted(payload: KenoDrawStartedPayload): void {
        this.server.emit('keno.draw.started', payload);
    }

    emitKenoDrawCompleted(draw: KenoDrawResponse): void {
        const payload: KenoDrawCompletedPayload = {
            drawId: draw.id,
            drawnNumbers: draw.drawnNumbers,
            settlementSummary: draw.settlementSummary,
        };
        this.server.emit('keno.draw.completed', payload);
    }

    emitBingoRoomUpdated(room: BingoRoomResponse): void {
        const payload: BingoRoomUpdatedPayload = {
            roomId: room.id,
            status: room.status,
            soldTickets: room.soldTickets,
            scheduledStartAt: room.scheduledStartAt,
        };
        this.server.emit('bingo.room.updated', payload);
    }

    emitBingoNumberDrawn(room: BingoRoomResponse, intervalMs: number): void {
        const drawnNumbers = room.drawnNumbers;
        const latestNumber = drawnNumbers[drawnNumbers.length - 1];
        if (latestNumber === undefined) return;

        const payload: BingoNumberDrawnPayload = {
            roomId: room.id,
            number: latestNumber,
            drawIndex: drawnNumbers.length - 1,
            totalDrawn: drawnNumbers.length,
            winnersByTier: room.winnersByTier,
            settlementSummary: room.settlementSummary,
            emittedAt: Date.now(),
            intervalMs,
        };
        this.server.emit('bingo.number.drawn', payload);
    }

    emitBingoRoomCompleted(room: BingoRoomResponse): void {
        const payload: BingoRoomCompletedPayload = {
            roomId: room.id,
            drawnNumbers: room.drawnNumbers,
            winnersByTier: room.winnersByTier,
            settlementSummary: room.settlementSummary,
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

    /** Public live "All Bets" feed  broadcast to everyone watching the crash room. */
    emitCrashBetPublic(payload: Record<string, unknown>): void {
        this.server.to('game_crash').emit('crash.bet.public', payload);
    }

    emitCrashCashoutPublic(payload: Record<string, unknown>): void {
        this.server.to('game_crash').emit('crash.cashout.public', payload);
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
    handleBingoChatSend(
        client: Socket,
        payload: { roomId: string; text: string },
    ) {
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

    // ── Pool ────────────────────────────────────────────────────────────────────

    /** Spectators/players subscribe to a match's room to receive live state. */
    @SubscribeMessage('pool.join')
    async handlePoolJoin(client: Socket, payload: { matchId: string }) {
        if (payload?.matchId)
            await client.join(`pool_match_${payload.matchId}`);
    }

    @SubscribeMessage('pool.leave')
    async handlePoolLeave(client: Socket, payload: { matchId: string }) {
        if (payload?.matchId)
            await client.leave(`pool_match_${payload.matchId}`);
    }

    /** Whitelist of predefined quick-chat emote ids  keep in sync with the client's
     * POOL_EMOTES. Only these ids are relayed; no free text is ever accepted. */
    private static readonly POOL_EMOTES = new Set([
        'tooEasy',
        'bestShot',
        'watchLearn',
        'warmingUp',
        'luckNextTime',
        'feelingLucky',
        'niceShot',
        'wellPlayed',
        'gg',
        'respect',
        'rematch',
        'goodLuck',
    ]);
    private readonly lastEmoteAt = new Map<string, number>();

    /**
     * Relay a predefined quick-chat emote to everyone in the match room. Only a
     * whitelisted id crosses the wire (each client localizes it), and each user is
     * rate-limited so the taunts can't be spammed. Non-players are naturally
     * filtered client-side (the bubble only renders for the two seat users).
     */
    @SubscribeMessage('pool.emote')
    handlePoolEmote(
        client: Socket,
        payload: { matchId?: string; id?: string },
    ) {
        const matchId = payload?.matchId;
        const id = payload?.id;
        if (
            !matchId ||
            typeof id !== 'string' ||
            !GameEventsGateway.POOL_EMOTES.has(id)
        )
            return;
        const userId: string | undefined = client.data?.user?.sub;
        if (!userId) return;
        const now = Date.now();
        if (now - (this.lastEmoteAt.get(userId) ?? 0) < 1500) return; // ~1 per 1.5s
        this.lastEmoteAt.set(userId, now);
        this.server
            .to(`pool_match_${matchId}`)
            .emit('pool.emote', { matchId, userId, id, ts: now });
    }

    /** Authoritative board/turn state after any change. */
    emitPoolMatchUpdated(matchId: string, payload: unknown): void {
        this.server
            .to(`pool_match_${matchId}`)
            .emit('pool.match.updated', payload);
    }

    /** A resolved shot (for animation + the shot feed). */
    emitPoolShotResolved(matchId: string, payload: unknown): void {
        this.server
            .to(`pool_match_${matchId}`)
            .emit('pool.shot.resolved', payload);
    }

    emitPoolMatchEnded(matchId: string, payload: unknown): void {
        this.server
            .to(`pool_match_${matchId}`)
            .emit('pool.match.ended', payload);
    }

    /** Direct notification to a user that matchmaking paired them. */
    emitPoolMatchFound(userId: string, payload: unknown): void {
        this.server.to(`user_${userId}`).emit('pool.match.found', payload);
    }

    // ── Werk Flega (shared server-authoritative round) ───────────────────────────

    /**
     * Runtime-registered handler so the gateway can forward player input to the
     * WerkRoundManager without a circular module import. The manager registers
     * itself on bootstrap.
     */
    private werkInputHandler?: (userId: string, input: unknown) => void;

    registerWerkInputHandler(
        fn: (userId: string, input: unknown) => void,
    ): void {
        this.werkInputHandler = fn;
    }

    /** Distinct users currently on the Werk screen (in the lobby room). */
    werkPresenceCount(): number {
        return this.getDistinctUsers('game_werk').size;
    }

    /** Join the shared lobby room + a specific round's room to play/spectate. */
    @SubscribeMessage('werk.join')
    async handleWerkJoin(client: Socket, payload: { roundId?: string }) {
        await client.join('game_werk');
        if (payload?.roundId)
            await client.join(`werk_round_${payload.roundId}`);
    }

    @SubscribeMessage('werk.leave')
    async handleWerkLeave(client: Socket, payload: { roundId?: string }) {
        if (payload?.roundId)
            await client.leave(`werk_round_${payload.roundId}`);
        await client.leave('game_werk');
    }

    /** A player's per-tick input (analog move vector + sprint + power). */
    @SubscribeMessage('werk.input')
    handleWerkInput(client: Socket, payload: unknown) {
        const userId: string | undefined = client.data?.user?.sub;
        if (!userId || !this.werkInputHandler) return;
        this.werkInputHandler(userId, payload);
    }

    /** High-frequency authoritative snapshot of the running round. */
    emitWerkSnapshot(roundId: string, snapshot: unknown): void {
        this.server.to(`werk_round_${roundId}`).emit('werk.snapshot', snapshot);
    }

    /** Round lifecycle transition (lobby opened, countdown, started). */
    emitWerkRoundState(view: { id: string } & Record<string, unknown>): void {
        this.server.to('game_werk').emit('werk.round.state', view);
        this.server.to(`werk_round_${view.id}`).emit('werk.round.state', view);
    }

    /** Final standings when a round settles. */
    emitWerkRoundCompleted(
        view: { id: string } & Record<string, unknown>,
    ): void {
        this.server.to('game_werk').emit('werk.round.completed', view);
        this.server
            .to(`werk_round_${view.id}`)
            .emit('werk.round.completed', view);
    }
}
