import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { OutboundSmsService } from './outbound-sms.service';
import { RealtimeGateway } from './realtime.gateway';
import { WebPushDispatchService } from './web-push.service';

export interface NotificationRecipient {
  userId: string;
  role: UserRole;
  businessId?: string | null;
  phoneE164?: string | null;
}

export interface UserNotificationInput {
  eventType: string;
  category?: string;
  title: string;
  body: string;
  deepLink?: string | null;
  deepLinksByRole?: Partial<Record<UserRole, string>>;
  metadata?: Prisma.InputJsonValue;
  dedupeKey: string;
  recipients: NotificationRecipient[];
  smsMessage?: string;
  smsRecipientUserIds?: string[];
  outboxEventId?: string;
}

@Injectable()
export class UserNotificationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly webPushService: WebPushDispatchService,
    private readonly outboundSmsService: OutboundSmsService,
  ) {}

  async notify(input: UserNotificationInput): Promise<number> {
    const uniqueRecipients = new Map<string, NotificationRecipient>();
    for (const recipient of input.recipients) {
      if (recipient.userId) uniqueRecipients.set(recipient.userId, recipient);
    }

    const smsUserIds = new Set(input.smsRecipientUserIds ?? []);

    for (const recipient of uniqueRecipients.values()) {
      const dedupeKey = `${input.eventType}:${input.dedupeKey}:${recipient.userId}`.slice(0, 180);
      const stored = await this.prismaService.userNotification.upsert({
        where: {
          userId_dedupeKey: {
            userId: recipient.userId,
            dedupeKey,
          },
        },
        create: {
          userId: recipient.userId,
          businessId: recipient.businessId ?? null,
          role: recipient.role,
          eventType: input.eventType,
          category: input.category ?? 'STANDARD_UPDATE',
          title: input.title,
          body: input.body,
          deepLink: input.deepLinksByRole?.[recipient.role] ?? input.deepLink ?? null,
          metadata: input.metadata ?? Prisma.JsonNull,
          dedupeKey,
        },
        update: {},
        select: {
          id: true,
          eventType: true,
          category: true,
          title: true,
          body: true,
          deepLink: true,
          createdAt: true,
        },
      });

      const notificationPayload = {
        ...stored,
        createdAt: stored.createdAt.toISOString(),
        metadata: input.metadata ?? null,
      };

      this.realtimeGateway.sendToUser(recipient.userId, {
        notification: notificationPayload,
        event: input.eventType,
      });

      await this.webPushService.sendToUser(recipient.userId, {
        title: input.title,
        body: input.body,
        icon: '/icons/icon-192x192.png',
        data: {
          notificationId: stored.id,
          eventType: input.eventType,
          url: input.deepLinksByRole?.[recipient.role] ?? input.deepLink ?? '/dashboard',
        },
      });

      if (input.smsMessage && smsUserIds.has(recipient.userId) && recipient.phoneE164) {
        await this.outboundSmsService.queueAndDispatchSms({
          recipientPhoneE164: recipient.phoneE164,
          messageBody: input.smsMessage,
          outboxEventId: input.outboxEventId,
        });
      }
    }

    return uniqueRecipients.size;
  }

  async getInbox(userId: string, limit = 50, unreadOnly = false) {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const notifications = await this.prismaService.userNotification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });

    return {
      count: notifications.length,
      notifications: notifications.map((notification) => ({
        notificationId: notification.id,
        eventType: notification.eventType,
        category: notification.category,
        title: notification.title,
        body: notification.body,
        deepLink: notification.deepLink,
        metadata: notification.metadata,
        isRead: notification.isRead,
        readAt: notification.readAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString(),
      })),
      unreadCount: await this.prismaService.userNotification.count({
        where: { userId, isRead: false },
      }),
    };
  }

  async markRead(userId: string, notificationId: string) {
    const updated = await this.prismaService.userNotification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });

    if (updated.count === 0) {
      return { updated: false };
    }

    return { updated: true };
  }

  async markAllRead(userId: string) {
    const updated = await this.prismaService.userNotification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return { updated: updated.count };
  }
}
