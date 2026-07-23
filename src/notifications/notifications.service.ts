import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { GameEventsGateway } from '../events/game-events.gateway';
import { Notification, NotificationType } from './entities/notification.entity';

export type NotificationResponse = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: Date;
};

export type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    private readonly gateway: GameEventsGateway,
  ) {}

  /** Persist a notification and push it live to the user's socket room. */
  async create(input: CreateNotificationInput): Promise<Notification> {
    const note = this.notificationRepo.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? null,
      readAt: null,
    });
    const saved = await this.notificationRepo.save(note);
    this.gateway.emitUserNotification(input.userId, this.toResponse(saved));
    return saved;
  }

  /**
   * Best-effort create for use as a post-commit side effect — a notification
   * failure must never bubble up and roll back the money operation that
   * triggered it.
   */
  async safeCreate(input: CreateNotificationInput): Promise<void> {
    try {
      await this.create(input);
    } catch (err) {
      this.logger.error(
        `Failed to create ${input.type} notification for user ${input.userId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async list(userId: string, limit = 30): Promise<{ items: NotificationResponse[]; unreadCount: number }> {
    const [items, unreadCount] = await Promise.all([
      this.notificationRepo.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: Math.min(Math.max(limit, 1), 100),
      }),
      this.notificationRepo.count({ where: { userId, readAt: IsNull() } }),
    ]);
    return { items: items.map((n) => this.toResponse(n)), unreadCount };
  }

  async markRead(userId: string, ids?: string[]): Promise<{ unreadCount: number }> {
    if (ids && ids.length > 0) {
      await this.notificationRepo.update({ userId, id: In(ids), readAt: IsNull() }, { readAt: new Date() });
    } else {
      await this.notificationRepo.update({ userId, readAt: IsNull() }, { readAt: new Date() });
    }
    const unreadCount = await this.notificationRepo.count({ where: { userId, readAt: IsNull() } });
    return { unreadCount };
  }

  private toResponse(n: Notification): NotificationResponse {
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data,
      read: n.readAt != null,
      createdAt: n.createdAt,
    };
  }
}
