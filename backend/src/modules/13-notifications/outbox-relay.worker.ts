import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { OutboundSmsService } from './outbound-sms.service';
import { RealtimeGateway } from './realtime.gateway';
import { WebPushDispatchService } from './web-push.service';

@Injectable()
export class OutboxRelayWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayWorker.name);
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private pollIntervalMs = 3000;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly outboundSmsService: OutboundSmsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly webPushService: WebPushDispatchService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.isRunning = true;
    this.timer = setInterval(() => {
      void this.pollAndDispatchOutbox();
    }, this.pollIntervalMs);
    this.logger.log('SokoKuu OutboxRelayWorker started (polling pending outbox events).');
  }

  onModuleDestroy(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollAndDispatchOutbox(): Promise<number> {
    if (!this.isRunning) return 0;

    let processedCount = 0;
    try {
      const pendingEvents = await this.prismaService.domainOutboxEvent.findMany({
        where: {
          status: OutboxStatus.PENDING,
          OR: [
            { nextRetryAt: null },
            { nextRetryAt: { lte: new Date() } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });

      for (const evt of pendingEvents) {
        try {
          await this.prismaService.domainOutboxEvent.update({
            where: { id: evt.id },
            data: { status: OutboxStatus.PROCESSING },
          });

          await this.dispatchDomainEvent(evt.eventType, evt.routingKey, evt.payload as Record<string, any>);

          await this.prismaService.domainOutboxEvent.update({
            where: { id: evt.id },
            data: {
              status: OutboxStatus.PUBLISHED,
              publishedAt: new Date(),
              lastError: null,
            },
          });
          processedCount += 1;
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'OUTBOX_DISPATCH_FAILED';
          const nextRetry = evt.retryCount + 1;
          const isDead = nextRetry >= 5;
          const backoff = 15 * Math.pow(2, Math.min(nextRetry, 5));
          const nextRetryAt = isDead ? null : new Date(Date.now() + backoff * 1000);

          await this.prismaService.domainOutboxEvent.update({
            where: { id: evt.id },
            data: {
              status: isDead ? OutboxStatus.DEAD_LETTER : OutboxStatus.FAILED,
              retryCount: nextRetry,
              lastError: errMsg,
              nextRetryAt,
            },
          });
          this.logger.warn(
            `[SOKOKUU-OUTBOX-RETRY] eventId=${evt.id} type=${evt.eventType} status=${isDead ? 'DEAD_LETTER' : 'FAILED'} attempt=${nextRetry}/5 reason=${errMsg}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Outbox polling error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return processedCount;
  }

  private async dispatchDomainEvent(
    eventType: string,
    routingKey: string,
    payload: Record<string, any>,
  ): Promise<void> {
    this.logger.log(`Dispatching domain event type=${eventType} routingKey=${routingKey}`);

    if (eventType === 'ManagedOrderRoutedEvent' || eventType === 'DirectMerchantOrderPlacedEvent') {
      const orderRef = payload.orderRef ?? payload.orderRef8 ?? 'ORDER';
      const totalTzs = payload.expectedTotalTzs ?? 0;
      const adminMsg = `SokoKuu Alert: Oda #${orderRef} imepokelewa TZS ${totalTzs}.`;

      // Broadcast real-time WebSocket/Socket.IO admin alarm
      this.realtimeGateway.broadcastAdminAlert({
        event: eventType,
        orderId: payload.orderId,
        orderRef,
        sellerBusinessId: payload.sellerBusinessId,
        expectedTotalTzs: totalTzs,
        timestamp: new Date().toISOString(),
      });

      // Dispatch Web Push to admin/merchant subscribers
      await this.webPushService.broadcastToRole('SUPER_ADMIN', {
        title: 'Oda Mpya ya SokoKuu',
        body: adminMsg,
        data: { orderId: payload.orderId, url: `/dashboard/orders/${payload.orderId}` },
      });
    }

    if (eventType === 'BulkPackageBrokenEvent') {
      if (payload.smsMessage && payload.sellerBusinessId) {
        const profile = await this.prismaService.businessProfile.findUnique({
          where: { id: payload.sellerBusinessId },
          include: { owner: { select: { phoneE164: true } } },
        });
        if (profile?.owner?.phoneE164) {
          await this.outboundSmsService.queueAndDispatchSms({
            recipientPhoneE164: profile.owner.phoneE164,
            messageBody: payload.smsMessage,
          });
        }
      }
    }

    if (eventType === 'LeadConvertedEvent') {
      if (payload.smsMessage && payload.ownerPhoneE164) {
        await this.outboundSmsService.queueAndDispatchSms({
          recipientPhoneE164: payload.ownerPhoneE164,
          messageBody: payload.smsMessage,
        });
      }
    }

    if (eventType === 'DriverPinModalTriggerEvent') {
      if (payload.driverUserId) {
        this.realtimeGateway.sendToDriver(payload.driverUserId, {
          signal: 'TRIGGER_DRIVER_PIN_MODAL_OPEN',
          orderId: payload.orderId,
          orderRef: payload.orderRef,
          expectedCashAmountTzs: payload.expectedCashAmountTzs,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}
