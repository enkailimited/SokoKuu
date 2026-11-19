import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webPush from 'web-push';
import { PrismaService } from '@database/prisma.service';

export interface WebPushPayload {
  title: string;
  body: string;
  icon?: string;
  data?: Record<string, any>;
}

@Injectable()
export class WebPushDispatchService {
  private readonly logger = new Logger(WebPushDispatchService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const vapidSubject = this.configService.get<string>('VAPID_SUBJECT') ?? 'mailto:ops@sokokuu.tz';
    const vapidPublic = this.configService.get<string>('VAPID_PUBLIC_KEY') ?? '';
    const vapidPrivate = this.configService.get<string>('VAPID_PRIVATE_KEY') ?? '';

    if (vapidPublic && vapidPrivate) {
      try {
        webPush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
      } catch (err) {
        this.logger.warn(`Failed to configure VAPID details: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async upsertSubscription(userId: string, subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    deviceType?: string;
  }) {
    return this.prismaService.webPushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dhKey: subscription.keys.p256dh,
        authSecret: subscription.keys.auth,
        deviceType: subscription.deviceType ?? 'Web Browser',
      },
      update: {
        userId,
        p256dhKey: subscription.keys.p256dh,
        authSecret: subscription.keys.auth,
        deviceType: subscription.deviceType ?? 'Web Browser',
        updatedAt: new Date(),
      },
    });
  }

  async removeSubscription(endpoint: string) {
    try {
      await this.prismaService.webPushSubscription.delete({
        where: { endpoint },
      });
      return { success: true, removed: endpoint };
    } catch {
      return { success: false, removed: endpoint };
    }
  }

  async sendToUser(userId: string, payload: WebPushPayload): Promise<number> {
    return this.sendToUsers([userId], payload);
  }

  async sendToUsers(userIds: string[], payload: WebPushPayload): Promise<number> {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) return 0;

    const subs = await this.prismaService.webPushSubscription.findMany({
      where: { userId: { in: uniqueUserIds }, user: { isActive: true } },
    });

    let sentCount = 0;
    const jsonPayload = JSON.stringify(payload);

    for (const sub of subs) {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dhKey,
              auth: sub.authSecret,
            },
          },
          jsonPayload,
        );
        sentCount += 1;
      } catch (error: any) {
        const statusCode = error?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await this.removeSubscription(sub.endpoint);
        } else {
          this.logger.warn(`Web push dispatch failed for endpoint ${sub.endpoint.slice(0, 30)}: ${error.message}`);
        }
      }
    }

    return sentCount;
  }

  async broadcastToRole(role: string, payload: WebPushPayload): Promise<number> {
    const users = await this.prismaService.user.findMany({
      where: { role: role as any, isActive: true },
      select: { id: true },
    });
    return this.sendToUsers(
      users.map((user) => user.id),
      payload,
    );
  }
}
