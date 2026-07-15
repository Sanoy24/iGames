import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportGateway } from './support.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';
import { Withdrawal } from '../wallet/entities/withdrawal.entity';
import { TelebirrDeposit } from '../payments/entities/telebirr-deposit.entity';
import {
  SupportMessage,
  SupportMessageAuthorRole,
  SupportRequestType,
  SupportRequestStatus,
} from './entities/support-message.entity';
import {
  SupportTicket,
  SupportTicketCategory,
  SupportTicketStatus,
} from './entities/support-ticket.entity';
import { PostMessageDto } from './dto/post-message.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { ApproveRefundDto, RejectRefundDto } from './dto/resolve-refund.dto';
import { ListTicketsQuery } from './dto/list-tickets.query';

/** relatedType values we can verify ownership for. Others are stored as-is. */
const OWNERSHIP_CHECKED_TYPES = new Set(['withdrawal', 'deposit']);

export type SupportMessageResponse = {
  id: string;
  authorId: string | null;
  authorRole: SupportMessageAuthorRole;
  body: string;
  attachments: Record<string, unknown>[] | null;
  internal: boolean;
  createdAt: Date;
  // Present only when the message is a tagged request.
  requestType: SupportRequestType | null;
  requestStatus: SupportRequestStatus | null;
  requestedAmountMinor: number | null;
  relatedType: string | null;
  relatedId: string | null;
  refundedAmountMinor: number | null;
  resolutionNote: string | null;
  decidedAt: Date | null;
};

export type SupportTicketResponse = {
  id: string;
  userId: string;
  category: SupportTicketCategory;
  subject: string;
  status: SupportTicketStatus;
  priority: string;
  assignedAgentId: string | null;
  relatedType: string | null;
  relatedId: string | null;
  requestedAmountMinor: number | null;
  resolutionType: string | null;
  resolutionNote: string | null;
  refundLedgerEntryId: string | null;
  refundedAmountMinor: number | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(SupportMessage)
    private readonly messageRepo: Repository<SupportMessage>,
    @InjectRepository(Withdrawal)
    private readonly withdrawalRepo: Repository<Withdrawal>,
    @InjectRepository(TelebirrDeposit)
    private readonly depositRepo: Repository<TelebirrDeposit>,
    private readonly walletService: WalletService,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => SupportGateway))
    private readonly gateway: SupportGateway,
  ) {}

  // ==========================================================================
  // Player-facing — one persistent conversation per user
  // ==========================================================================

  /** The user's single support conversation (created on first contact). */
  async getOrOpenConversation(userId: string): Promise<SupportTicket> {
    const existing = await this.ticketRepo.findOne({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
    if (existing) {
      // The conversation is permanent — reopen it if it was previously closed.
      if (existing.status === 'closed' || existing.status === 'resolved') {
        existing.status = 'open';
        existing.closedAt = null;
        await this.ticketRepo.save(existing);
      }
      return existing;
    }
    return this.ticketRepo.save(
      this.ticketRepo.create({
        userId,
        category: 'live_chat',
        subject: 'Support',
        status: 'open',
        priority: 'normal',
        lastMessageAt: new Date(),
      }),
    );
  }

  /** The user's conversation thread (creates it if this is first contact). */
  async getMyConversation(userId: string) {
    const ticket = await this.getOrOpenConversation(userId);
    const messages = await this.loadMessages(ticket.id, { includeInternal: false });
    return { ticket: this.toTicketResponse(ticket), messages };
  }

  /**
   * Post a message into the user's one conversation. When `requestType` is set,
   * the message IS a tagged request (refund/dispute/complaint) the agent must
   * act on — many such requests can live in the same chat over time.
   */
  async postUserMessage(userId: string, dto: PostMessageDto) {
    const ticket = await this.getOrOpenConversation(userId);

    const requestType = dto.requestType ?? null;
    let requestedAmountMinor: number | null = null;
    let relatedType: string | null = null;
    let relatedId: string | null = null;

    if (requestType) {
      if (requestType === 'refund') {
        requestedAmountMinor = dto.requestedAmountMinor ?? null;
        if (!requestedAmountMinor || requestedAmountMinor < 1) {
          throw new BadRequestException('A refund request must include a positive amount.');
        }
      }
      if (dto.relatedType && dto.relatedId) {
        await this.assertRelatedOwnership(userId, dto.relatedType, dto.relatedId);
        relatedType = dto.relatedType;
        relatedId = dto.relatedId;
      }
    }

    const message = await this.appendMessage(ticket.id, {
      authorId: userId,
      authorRole: 'user',
      body: dto.body.trim(),
      attachments: dto.attachments,
      requestType,
      requestedAmountMinor,
      relatedType,
      relatedId,
    });

    // A user message (or new request) moves the ball to the agents.
    await this.ticketRepo.update({ id: ticket.id }, { status: 'pending_agent' });

    this.gateway.emitSupportMessage(ticket.id, this.toMessageEvent(ticket.id, message, ticket.assignedAgentId));
    if (requestType) {
      this.gateway.emitSupportTicketCreated({
        ticketId: ticket.id,
        userId,
        category: requestType,
        subject: ticket.subject,
        priority: requestType === 'refund' || requestType === 'dispute' ? 'high' : 'normal',
      });
    }

    return this.toMessageResponse(message);
  }

  // ==========================================================================
  // Agent / admin facing
  // ==========================================================================

  async listTickets(query: ListTicketsQuery, callerId: string): Promise<{ items: SupportTicketResponse[]; total: number }> {
    const limit = Math.min(Math.max(parseInt(query.limit ?? '30', 10) || 30, 1), 100);
    const offset = Math.max(parseInt(query.offset ?? '0', 10) || 0, 0);

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.assignedAgentId) {
      where.assignedAgentId = query.assignedAgentId === 'me' ? callerId : query.assignedAgentId;
    }

    const [items, total] = await this.ticketRepo.findAndCount({
      where,
      order: { priority: 'DESC', lastMessageAt: 'DESC', createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items: items.map((t) => this.toTicketResponse(t)), total };
  }

  async getTicketForAgent(ticketId: string) {
    const ticket = await this.ticketRepo.findOneBy({ id: ticketId });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const messages = await this.loadMessages(ticketId, { includeInternal: true });
    return { ticket: this.toTicketResponse(ticket), messages };
  }

  async postAgentMessage(agentId: string, ticketId: string, dto: PostMessageDto) {
    const ticket = await this.requireTicket(ticketId);
    if (ticket.status === 'closed') {
      throw new ConflictException('Cannot reply to a closed ticket');
    }
    const internal = dto.internal === true;

    const message = await this.appendMessage(ticketId, {
      authorId: agentId,
      authorRole: 'agent',
      body: dto.body.trim(),
      attachments: dto.attachments,
      internal,
    });

    // A public reply moves the ball to the user; internal notes change nothing.
    if (!internal) {
      const patch: Partial<SupportTicket> = { status: 'pending_user' };
      if (!ticket.assignedAgentId) patch.assignedAgentId = agentId;
      await this.ticketRepo.update({ id: ticketId }, patch);

      await this.notifications.safeCreate({
        userId: ticket.userId,
        type: 'system',
        title: 'Support replied',
        body: 'An agent replied in your support chat.',
        data: { ticketId, category: ticket.category },
      });
      this.gateway.emitSupportMessage(ticketId, this.toMessageEvent(ticketId, message, ticket.assignedAgentId ?? agentId));
    }

    return this.toMessageResponse(message);
  }

  async updateTicket(agentId: string, ticketId: string, dto: UpdateTicketDto): Promise<SupportTicketResponse> {
    const ticket = await this.requireTicket(ticketId);
    const changes: string[] = [];

    if (dto.status && dto.status !== ticket.status) {
      ticket.status = dto.status;
      if (dto.status === 'closed' || dto.status === 'resolved') {
        ticket.closedAt = ticket.closedAt ?? new Date();
      }
      changes.push(`status → ${dto.status}`);
    }
    if (dto.priority && dto.priority !== ticket.priority) {
      ticket.priority = dto.priority;
      changes.push(`priority → ${dto.priority}`);
    }
    if (dto.assignedAgentId !== undefined) {
      ticket.assignedAgentId = dto.assignedAgentId || null;
      changes.push(ticket.assignedAgentId ? `assigned → ${ticket.assignedAgentId}` : 'unassigned');
    }

    await this.ticketRepo.save(ticket);
    if (changes.length > 0) {
      await this.appendSystemMessage(ticketId, `Agent ${agentId} updated ticket: ${changes.join(', ')}.`);
    }
    return this.toTicketResponse(ticket);
  }

  async claimTicket(agentId: string, ticketId: string): Promise<SupportTicketResponse> {
    const ticket = await this.requireTicket(ticketId);
    if (ticket.assignedAgentId && ticket.assignedAgentId !== agentId) {
      throw new ConflictException('Ticket is already assigned to another agent');
    }
    ticket.assignedAgentId = agentId;
    if (ticket.status === 'open') ticket.status = 'pending_agent';
    await this.ticketRepo.save(ticket);
    await this.appendSystemMessage(ticketId, `Agent ${agentId} claimed the ticket.`);
    return this.toTicketResponse(ticket);
  }

  // --- Request resolution (message-level, inside the one conversation) -------

  /** Load a pending tagged-request message + its conversation, or throw. */
  private async requireRequestMessage(messageId: string): Promise<{ message: SupportMessage; ticket: SupportTicket }> {
    const message = await this.messageRepo.findOneBy({ id: messageId });
    if (!message || !message.requestType) throw new NotFoundException('Request not found');
    if (message.requestStatus && message.requestStatus !== 'pending') {
      throw new ConflictException(`Request already ${message.requestStatus}`);
    }
    const ticket = await this.requireTicket(message.ticketId);
    return { message, ticket };
  }

  /** Approve a refund REQUEST (a tagged message) — credits the wallet. */
  async approveRefundRequest(agentId: string, messageId: string, dto: ApproveRefundDto): Promise<SupportMessageResponse> {
    const { message, ticket } = await this.requireRequestMessage(messageId);
    if (message.requestType !== 'refund') {
      throw new BadRequestException('Only a refund request can be approved for a refund');
    }

    const amountMinor = dto.amountMinor ?? message.requestedAmountMinor ?? 0;
    if (amountMinor < 1) throw new BadRequestException('Refund amount must be positive');
    if (message.requestedAmountMinor && amountMinor > message.requestedAmountMinor) {
      throw new BadRequestException('Refund amount cannot exceed the requested amount');
    }

    // Ledger-backed, idempotent per REQUEST — re-approving won't double-credit.
    const result = await this.walletService.credit({
      userId: ticket.userId,
      amountMinor,
      entryType: 'refund',
      sourceType: 'support_refund',
      sourceId: message.id,
      idempotencyKey: `support-refund:${message.id}`,
      metadata: { ticketId: ticket.id, messageId: message.id, approvedBy: agentId, relatedType: message.relatedType, relatedId: message.relatedId },
    });

    message.requestStatus = 'approved';
    message.resolutionNote = dto.note?.trim() ?? null;
    message.refundLedgerEntryId = result.ledgerEntry.id;
    message.refundedAmountMinor = amountMinor;
    message.decidedBy = agentId;
    message.decidedAt = new Date();
    await this.messageRepo.save(message);

    await this.appendSystemMessage(ticket.id, `Refund of ${amountMinor} approved by agent ${agentId} (ledger ${result.ledgerEntry.id}).`);
    await this.notifications.safeCreate({
      userId: ticket.userId,
      type: 'adjustment',
      title: 'Refund approved',
      body: `Your refund request was approved and ${amountMinor} credited to your wallet.`,
      data: { ticketId: ticket.id, messageId: message.id, amountMinor, ledgerEntryId: result.ledgerEntry.id },
    });
    this.gateway.emitSupportRequestUpdated(ticket.userId, ticket.id, {
      messageId: message.id,
      requestType: message.requestType,
      requestStatus: message.requestStatus,
      refundedAmountMinor: message.refundedAmountMinor,
    });

    return this.toMessageResponse(message);
  }

  /** Reject any tagged request (refund/dispute/complaint) with a reason. */
  async rejectRequest(agentId: string, messageId: string, dto: RejectRefundDto): Promise<SupportMessageResponse> {
    const { message, ticket } = await this.requireRequestMessage(messageId);

    message.requestStatus = 'rejected';
    message.resolutionNote = dto.reason.trim();
    message.decidedBy = agentId;
    message.decidedAt = new Date();
    await this.messageRepo.save(message);

    await this.appendSystemMessage(ticket.id, `${message.requestType} request declined by agent ${agentId}: ${dto.reason.trim()}`);
    await this.notifications.safeCreate({
      userId: ticket.userId,
      type: 'system',
      title: message.requestType === 'refund' ? 'Refund declined' : 'Request declined',
      body: `Your ${message.requestType} request was declined. Reason: ${dto.reason.trim()}`,
      data: { ticketId: ticket.id, messageId: message.id },
    });
    this.gateway.emitSupportRequestUpdated(ticket.userId, ticket.id, {
      messageId: message.id,
      requestType: message.requestType,
      requestStatus: message.requestStatus,
    });

    return this.toMessageResponse(message);
  }

  // ==========================================================================
  // Live chat (used by the gateway)
  // ==========================================================================

  /** Alias — the live chat and the ticket conversation are one and the same. */
  async getOrOpenLiveChat(userId: string): Promise<SupportTicket> {
    return this.getOrOpenConversation(userId);
  }

  async appendLiveChatMessage(
    ticketId: string,
    author: { authorId: string; authorRole: SupportMessageAuthorRole },
    body: string,
  ): Promise<SupportMessageResponse> {
    const text = body.trim().slice(0, 2000);
    const message = await this.appendMessage(ticketId, {
      authorId: author.authorId,
      authorRole: author.authorRole,
      body: text,
    });
    if (author.authorRole === 'agent') {
      await this.ticketRepo.update({ id: ticketId }, { status: 'pending_user' });
    } else if (author.authorRole === 'user') {
      await this.ticketRepo.update({ id: ticketId }, { status: 'pending_agent' });
    }
    return this.toMessageResponse(message);
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private async requireTicket(ticketId: string): Promise<SupportTicket> {
    const ticket = await this.ticketRepo.findOneBy({ id: ticketId });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  private async appendMessage(
    ticketId: string,
    input: {
      authorId: string | null;
      authorRole: SupportMessageAuthorRole;
      body: string;
      attachments?: Record<string, unknown>[];
      internal?: boolean;
      requestType?: SupportRequestType | null;
      requestStatus?: SupportRequestStatus | null;
      requestedAmountMinor?: number | null;
      relatedType?: string | null;
      relatedId?: string | null;
    },
  ): Promise<SupportMessage> {
    const message = await this.messageRepo.save(
      this.messageRepo.create({
        ticketId,
        authorId: input.authorId,
        authorRole: input.authorRole,
        body: input.body,
        attachments: input.attachments ?? null,
        internal: input.internal ?? false,
        requestType: input.requestType ?? null,
        requestStatus: input.requestType ? (input.requestStatus ?? 'pending') : null,
        requestedAmountMinor: input.requestedAmountMinor ?? null,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
      }),
    );
    // Public messages bump the inbox sort key; internal notes don't reorder the queue.
    if (!message.internal) {
      await this.ticketRepo.update({ id: ticketId }, { lastMessageAt: message.createdAt });
    }
    return message;
  }

  private appendSystemMessage(ticketId: string, body: string): Promise<SupportMessage> {
    return this.appendMessage(ticketId, { authorId: null, authorRole: 'system', body });
  }

  private async loadMessages(
    ticketId: string,
    opts: { includeInternal: boolean },
  ): Promise<SupportMessageResponse[]> {
    const where = opts.includeInternal ? { ticketId } : { ticketId, internal: false };
    const messages = await this.messageRepo.find({
      where,
      order: { createdAt: 'ASC' },
    });
    return messages.map((m) => this.toMessageResponse(m));
  }

  /**
   * Verify a dispute/refund's referenced transaction actually belongs to the
   * player, so a user can't dispute someone else's withdrawal. Unknown
   * relatedTypes are accepted as free references.
   */
  private async assertRelatedOwnership(userId: string, relatedType: string, relatedId: string): Promise<void> {
    if (!OWNERSHIP_CHECKED_TYPES.has(relatedType)) return;

    if (relatedType === 'withdrawal') {
      const w = await this.withdrawalRepo.findOneBy({ id: relatedId });
      if (!w || w.userId !== userId) {
        throw new ForbiddenException('Referenced withdrawal does not belong to you');
      }
    } else if (relatedType === 'deposit') {
      const d = await this.depositRepo.findOneBy({ id: relatedId });
      if (!d || d.userId !== userId) {
        throw new ForbiddenException('Referenced deposit does not belong to you');
      }
    }
  }

  private toTicketResponse(t: SupportTicket): SupportTicketResponse {
    return {
      id: t.id,
      userId: t.userId,
      category: t.category,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      assignedAgentId: t.assignedAgentId,
      relatedType: t.relatedType,
      relatedId: t.relatedId,
      requestedAmountMinor: t.requestedAmountMinor,
      resolutionType: t.resolutionType,
      resolutionNote: t.resolutionNote,
      refundLedgerEntryId: t.refundLedgerEntryId,
      refundedAmountMinor: t.refundedAmountMinor,
      lastMessageAt: t.lastMessageAt,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  /** Socket payload for a single message (includes request tags for the UI). */
  private toMessageEvent(ticketId: string, m: SupportMessage, assignedAgentId: string | null) {
    return {
      ticketId,
      messageId: m.id,
      authorRole: m.authorRole,
      authorId: m.authorId,
      body: m.body,
      assignedAgentId: assignedAgentId ?? null,
      createdAt: m.createdAt,
      requestType: m.requestType,
      requestStatus: m.requestStatus,
      requestedAmountMinor: m.requestedAmountMinor,
    };
  }

  private toMessageResponse(m: SupportMessage): SupportMessageResponse {
    return {
      id: m.id,
      authorId: m.authorId,
      authorRole: m.authorRole,
      body: m.body,
      attachments: m.attachments,
      internal: m.internal,
      createdAt: m.createdAt,
      requestType: m.requestType,
      requestStatus: m.requestStatus,
      requestedAmountMinor: m.requestedAmountMinor,
      relatedType: m.relatedType,
      relatedId: m.relatedId,
      refundedAmountMinor: m.refundedAmountMinor,
      resolutionNote: m.resolutionNote,
      decidedAt: m.decidedAt,
    };
  }
}
