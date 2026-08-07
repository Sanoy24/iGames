import { Inject, Logger, forwardRef } from '@nestjs/common';
import {
    OnGatewayConnection,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '../users/entities/user.entity';
import { SupportService } from './support.service';

export type SupportTicketCreatedPayload = {
    ticketId: string;
    userId: string;
    category: string;
    subject: string;
    priority: string;
};

export type SupportMessagePayload = {
    ticketId: string;
    messageId: string;
    authorRole: 'user' | 'agent' | 'system';
    authorId: string | null;
    body: string;
    assignedAgentId: string | null;
    createdAt: Date;
    requestType?: string | null;
    requestStatus?: string | null;
    requestedAmountMinor?: number | null;
};

export type SupportTicketUpdatedPayload = {
    ticketId: string;
    status: string;
    resolutionType?: string | null;
};

export type SupportRequestUpdatedPayload = {
    messageId: string;
    requestType: string | null;
    requestStatus: string | null;
    refundedAmountMinor?: number | null;
};

/**
 * Dedicated Socket.IO namespace for support. Kept separate from the game events
 * gateway so support traffic (live chat, agent inbox pushes) is isolated and the
 * shared gateway stays free of support dependencies.
 *
 * Rooms:
 *  - `support_user_<userId>`    everything addressed to one player
 *  - `support_agents`           inbox-wide broadcasts to all agents
 *  - `support_ticket_<id>`      participants actively viewing a thread
 */
@WebSocketGateway({
    namespace: '/support',
    cors: { origin: true, credentials: true },
})
export class SupportGateway implements OnGatewayConnection {
    @WebSocketServer()
    private readonly server: Server;

    private readonly logger = new Logger(SupportGateway.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        @Inject(forwardRef(() => SupportService))
        private readonly support: SupportService,
    ) {}

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth?.token;
            if (!token) throw new Error('No token provided');

            const secret =
                this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
            const payload = await this.jwtService.verifyAsync(token, {
                secret,
            });
            if (!payload.sub) throw new Error('Token payload missing sub');

            const user = await this.userRepository.findOne({
                where: { id: payload.sub },
                select: ['id', 'status', 'roles', 'displayName'],
            });
            if (!user || user.status !== 'active')
                throw new Error('Account is not active');

            client.data.user = payload;
            client.data.displayName = user.displayName ?? 'Player';
            client.data.isAgent =
                Array.isArray(user.roles) &&
                (user.roles.includes('agent') || user.roles.includes('admin'));

            await client.join(`support_user_${payload.sub}`);
            if (client.data.isAgent) {
                await client.join('support_agents');
            }
            this.logger.debug(
                `Support socket connected: ${client.id} (user ${payload.sub})`,
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            this.logger.warn(
                `Unauthorized support socket: ${client.id} - ${message}`,
            );
            client.disconnect();
        }
    }

    /** Join/leave a specific ticket thread to receive its live messages. */
    @SubscribeMessage('support.ticket.open')
    async handleOpenTicket(client: Socket, payload: { ticketId: string }) {
        if (payload?.ticketId)
            await client.join(`support_ticket_${payload.ticketId}`);
    }

    @SubscribeMessage('support.ticket.leave')
    async handleLeaveTicket(client: Socket, payload: { ticketId: string }) {
        if (payload?.ticketId)
            await client.leave(`support_ticket_${payload.ticketId}`);
    }

    /** Live chat send. Persists to a `live_chat` ticket, then fans the message out. */
    @SubscribeMessage('support.chat.send')
    async handleChatSend(
        client: Socket,
        payload: { ticketId?: string; text: string },
    ) {
        const userId: string | undefined = client.data.user?.sub;
        if (!userId || typeof payload?.text !== 'string') return;
        const text = payload.text.trim().slice(0, 2000);
        if (!text) return;

        const isAgent: boolean = client.data.isAgent === true;

        // Agents reply into an existing ticket; players append to their own live chat.
        let ticketId = payload.ticketId;
        if (!isAgent) {
            const ticket = await this.support.getOrOpenLiveChat(userId);
            ticketId = ticket.id;
            await client.join(`support_ticket_${ticketId}`);
        }
        if (!ticketId) return;

        const message = await this.support.appendLiveChatMessage(
            ticketId,
            { authorId: userId, authorRole: isAgent ? 'agent' : 'user' },
            text,
        );

        this.emitSupportMessage(ticketId, {
            ticketId,
            messageId: message.id,
            authorRole: message.authorRole,
            authorId: message.authorId,
            body: message.body,
            assignedAgentId: null,
            createdAt: message.createdAt,
        });
        // Surface new live chats to the whole agent pool so someone can pick it up.
        if (!isAgent) {
            this.server
                .to('support_agents')
                .emit('support.livechat.activity', { ticketId, userId });
        }
    }

    @SubscribeMessage('support.typing')
    handleTyping(
        client: Socket,
        payload: { ticketId: string; typing: boolean },
    ) {
        if (!payload?.ticketId) return;
        client.to(`support_ticket_${payload.ticketId}`).emit('support.typing', {
            ticketId: payload.ticketId,
            userId: client.data.user?.sub,
            displayName: client.data.displayName,
            typing: payload.typing === true,
        });
    }

    // --- Server → client emits (called by SupportService) --------------------

    emitSupportTicketCreated(payload: SupportTicketCreatedPayload): void {
        this.server
            ?.to('support_agents')
            .emit('support.ticket.created', payload);
    }

    emitSupportMessage(ticketId: string, payload: SupportMessagePayload): void {
        this.server
            ?.to(`support_ticket_${ticketId}`)
            .emit('support.message.new', payload);
        this.server?.to('support_agents').emit('support.message.new', payload);
    }

    emitSupportTicketUpdated(
        userId: string,
        payload: SupportTicketUpdatedPayload,
    ): void {
        this.server
            ?.to(`support_user_${userId}`)
            .emit('support.ticket.updated', payload);
        this.server
            ?.to(`support_ticket_${payload.ticketId}`)
            .emit('support.ticket.updated', payload);
    }

    /** A tagged request was approved/rejected  update the user + the thread viewers. */
    emitSupportRequestUpdated(
        userId: string,
        ticketId: string,
        payload: SupportRequestUpdatedPayload,
    ): void {
        this.server
            ?.to(`support_user_${userId}`)
            .emit('support.request.updated', payload);
        this.server
            ?.to(`support_ticket_${ticketId}`)
            .emit('support.request.updated', payload);
        this.server
            ?.to('support_agents')
            .emit('support.request.updated', payload);
    }
}
