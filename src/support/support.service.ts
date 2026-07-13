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
} from './entities/support-message.entity';
import {
  SupportTicket,
  SupportTicketCategory,
  SupportTicketStatus,
} from './entities/support-ticket.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
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
  // Player-facing
  // ==========================================================================

  async createTicket(userId: string, dto: CreateTicketDto): Promise<SupportTicketResponse> {
    if (dto.category === 'refund') {
      if (!dto.requestedAmountMinor || dto.requestedAmountMinor < 1) {
        throw new BadRequestException('Refund requests must include a positive requestedAmountMinor');
      }
    }

    if (dto.relatedType && dto.relatedId) {
      await this.assertRelatedOwnership(userId, dto.relatedType, dto.relatedId);
    } else if (dto.category === 'dispute' && (!dto.relatedType || !dto.relatedId)) {
      // Disputes should point at something; allow it but keep it soft for now.
      this.logger.debug(`Dispute ticket created by ${userId} without a related transaction`);
    }

    const now = new Date();
    const ticket = await this.ticketRepo.save(
      this.ticketRepo.create({
        userId,
        category: dto.category,
        subject: dto.subject.trim(),
        status: 'open',
        priority: dto.category === 'refund' || dto.category === 'dispute' ? 'high' : 'normal',
        relatedType: dto.relatedType ?? null,
        relatedId: dto.relatedId ?? null,
        requestedAmountMinor: dto.requestedAmountMinor ?? null,
        lastMessageAt: now,
      }),
    );

    await this.appendMessage(ticket.id, {
      authorId: userId,
      authorRole: 'user',
      body: dto.body.trim(),
    });

    this.gateway.emitSupportTicketCreated({
      ticketId: ticket.id,
      userId,
      category: ticket.category,
      subject: ticket.subject,
      priority: ticket.priority,
    });

    return this.toTicketResponse(ticket);
  }

  async listMyTickets(userId: string, limit = 30): Promise<SupportTicketResponse[]> {
    const tickets = await this.ticketRepo.find({
      where: { userId },
      order: { lastMessageAt: 'DESC', createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return tickets.map((t) => this.toTicketResponse(t));
  }

  async getMyTicket(userId: string, ticketId: string) {
    const ticket = await this.ticketRepo.findOneBy({ id: ticketId });
    if (!ticket || ticket.userId !== userId) {
      throw new NotFoundException('Ticket not found');
    }
    const messages = await this.loadMessages(ticketId, { includeInternal: false });
    return { ticket: this.toTicketResponse(ticket), messages };
  }

  async postUserMessage(userId: string, ticketId: string, dto: PostMessageDto) {
    const ticket = await this.ticketRepo.findOneBy({ id: ticketId });
    if (!ticket || ticket.userId !== userId) {
      throw new NotFoundException('Ticket not found');
    }
    if (ticket.status === 'closed') {
      throw new ConflictException('This ticket is closed. Please open a new one.');
    }

    const message = await this.appendMessage(ticketId, {
      authorId: userId,
      authorRole: 'user',
      body: dto.body.trim(),
      attachments: dto.attachments,
    });

    // A user reply re-opens the ball in the agent's court.
    if (ticket.status !== 'open' && ticket.status !== 'pending_agent') {
      await this.ticketRepo.update({ id: ticketId }, { status: 'pending_agent' });
    }

    this.gateway.emitSupportMessage(ticketId, {
      ticketId,
      messageId: message.id,
      authorRole: 'user',
      authorId: userId,
      body: message.body,
      assignedAgentId: ticket.assignedAgentId,
      createdAt: message.createdAt,
    });

    return this.toMessageResponse(message);
  }

  async closeMyTicket(userId: string, ticketId: string): Promise<SupportTicketResponse> {
    const ticket = await this.ticketRepo.findOneBy({ id: ticketId });
    if (!ticket || ticket.userId !== userId) {
      throw new NotFoundException('Ticket not found');
    }
    if (ticket.status === 'closed') return this.toTicketResponse(ticket);

    ticket.status = 'closed';
    ticket.closedAt = new Date();
    await this.ticketRepo.save(ticket);
    await this.appendSystemMessage(ticketId, 'Ticket closed by the user.');
    return this.toTicketResponse(ticket);
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
        body: `An agent replied to your ticket: ${ticket.subject}`,
        data: { ticketId, category: ticket.category },
      });
      this.gateway.emitSupportMessage(ticketId, {
        ticketId,
        messageId: message.id,
        authorRole: 'agent',
        authorId: agentId,
        body: message.body,
        assignedAgentId: ticket.assignedAgentId ?? agentId,
        createdAt: message.createdAt,
      });
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

  // --- Refund resolution ----------------------------------------------------

  async approveRefund(agentId: string, ticketId: string, dto: ApproveRefundDto): Promise<SupportTicketResponse> {
    const ticket = await this.requireTicket(ticketId);
    if (ticket.category !== 'refund') {
      throw new BadRequestException('Only refund tickets can be approved for a refund');
    }
    if (ticket.resolutionType) {
      throw new ConflictException(`Ticket already resolved as ${ticket.resolutionType}`);
    }

    const amountMinor = dto.amountMinor ?? ticket.requestedAmountMinor ?? 0;
    if (amountMinor < 1) {
      throw new BadRequestException('Refund amount must be positive');
    }
    if (ticket.requestedAmountMinor && amountMinor > ticket.requestedAmountMinor) {
      throw new BadRequestException('Refund amount cannot exceed the requested amount');
    }

    // Ledger-backed, idempotent: re-approving with the same ticket key will not double-credit.
    const result = await this.walletService.credit({
      userId: ticket.userId,
      amountMinor,
      entryType: 'refund',
      sourceType: 'support_refund',
      sourceId: ticket.id,
      idempotencyKey: `support-refund:${ticket.id}`,
      metadata: { ticketId: ticket.id, approvedBy: agentId, relatedType: ticket.relatedType, relatedId: ticket.relatedId },
    });

    ticket.resolutionType = 'refunded';
    ticket.resolutionNote = dto.note?.trim() ?? null;
    ticket.refundLedgerEntryId = result.ledgerEntry.id;
    ticket.refundedAmountMinor = amountMinor;
    ticket.decidedBy = agentId;
    ticket.decidedAt = new Date();
    ticket.status = 'resolved';
    ticket.closedAt = new Date();
    await this.ticketRepo.save(ticket);

    await this.appendSystemMessage(
      ticketId,
      `Refund of ${amountMinor} minor units approved by agent ${agentId} (ledger ${result.ledgerEntry.id}).`,
    );
    await this.notifications.safeCreate({
      userId: ticket.userId,
      type: 'adjustment',
      title: 'Refund approved',
      body: `Your refund request was approved and ${amountMinor} credited to your wallet.`,
      data: { ticketId, amountMinor, ledgerEntryId: result.ledgerEntry.id },
    });
    this.gateway.emitSupportTicketUpdated(ticket.userId, {
      ticketId,
      status: ticket.status,
      resolutionType: ticket.resolutionType,
    });

    return this.toTicketResponse(ticket);
  }

  async rejectTicket(agentId: string, ticketId: string, dto: RejectRefundDto): Promise<SupportTicketResponse> {
    const ticket = await this.requireTicket(ticketId);
    if (ticket.resolutionType) {
      throw new ConflictException(`Ticket already resolved as ${ticket.resolutionType}`);
    }
    ticket.resolutionType = 'rejected';
    ticket.resolutionNote = dto.reason.trim();
    ticket.decidedBy = agentId;
    ticket.decidedAt = new Date();
    ticket.status = 'resolved';
    ticket.closedAt = new Date();
    await this.ticketRepo.save(ticket);

    await this.appendSystemMessage(ticketId, `Ticket rejected by agent ${agentId}: ${dto.reason.trim()}`);
    await this.notifications.safeCreate({
      userId: ticket.userId,
      type: 'system',
      title: ticket.category === 'refund' ? 'Refund declined' : 'Ticket closed',
      body: `Your ${ticket.category} request was declined. Reason: ${dto.reason.trim()}`,
      data: { ticketId, category: ticket.category },
    });
    this.gateway.emitSupportTicketUpdated(ticket.userId, {
      ticketId,
      status: ticket.status,
      resolutionType: ticket.resolutionType,
    });

    return this.toTicketResponse(ticket);
  }

  // ==========================================================================
  // Live chat (used by the gateway)
  // ==========================================================================

  /** Find the user's active live-chat ticket, or open a fresh one. */
  async getOrOpenLiveChat(userId: string): Promise<SupportTicket> {
    const existing = await this.ticketRepo.findOne({
      where: { userId, category: 'live_chat' },
      order: { createdAt: 'DESC' },
    });
    if (existing && existing.status !== 'closed' && existing.status !== 'resolved') {
      return existing;
    }
    const now = new Date();
    return this.ticketRepo.save(
      this.ticketRepo.create({
        userId,
        category: 'live_chat',
        subject: 'Live chat',
        status: 'open',
        priority: 'normal',
        lastMessageAt: now,
      }),
    );
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

  private toMessageResponse(m: SupportMessage): SupportMessageResponse {
    return {
      id: m.id,
      authorId: m.authorId,
      authorRole: m.authorRole,
      body: m.body,
      attachments: m.attachments,
      internal: m.internal,
      createdAt: m.createdAt,
    };
  }
}
