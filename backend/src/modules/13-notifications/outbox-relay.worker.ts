import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { Role } from '@common/security/roles.enum';
import { OutboundSmsService } from './outbound-sms.service';
import { RealtimeGateway } from './realtime.gateway';
import {
  NotificationRecipient,
  UserNotificationInput,
  UserNotificationService,
} from './user-notification.service';

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
    private readonly userNotificationService: UserNotificationService,
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

          await this.dispatchDomainEvent(
            evt.eventType,
            evt.routingKey,
            evt.payload as Record<string, any>,
            evt.id,
          );

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

      const smsRetryResult = await this.outboundSmsService.processDueRetries();
      if (smsRetryResult.processed > 0) {
        this.logger.log(
          `[SOKOKUU-SMS-RELAY] processed=${smsRetryResult.processed} sent=${smsRetryResult.sent} deadLettered=${smsRetryResult.deadLettered}`,
        );
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
    outboxEventId: string,
  ): Promise<void> {
    this.logger.log(`Dispatching domain event type=${eventType} routingKey=${routingKey}`);

    const notification = await this.buildNotification(eventType, payload, outboxEventId);
    if (notification) {
      await this.userNotificationService.notify(notification);
    }

    if (eventType === 'ManagedOrderRoutedEvent' || eventType === 'DirectMerchantOrderPlacedEvent') {
      const orderRef = payload.orderRef ?? payload.orderRef8 ?? 'ORDER';
      this.realtimeGateway.broadcastAdminAlert({
        event: eventType,
        orderId: payload.orderId,
        orderRef,
        sellerBusinessId: payload.sellerBusinessId,
        expectedTotalTzs: payload.expectedTotalTzs ?? 0,
        timestamp: new Date().toISOString(),
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

  private deepLinkForRole(
    role: UserRole,
    options?: { orderRef?: string | null; orderId?: string | null; tab?: string | null },
  ): string {
    const params = new URLSearchParams();
    if (options?.tab) params.set('tab', options.tab);
    if (options?.orderRef) params.set('orderRef', options.orderRef);
    if (options?.orderId) params.set('orderId', options.orderId);
    const suffix = params.toString() ? `?${params.toString()}` : '';

    switch (role) {
      case UserRole.SUPER_ADMIN:
        return `/dashboard/admin${suffix}`;
      case UserRole.SALES_STAFF:
        return `/dashboard/sales${suffix}`;
      case UserRole.WHOLESALER:
        return `/dashboard/wholesaler${suffix}`;
      case UserRole.RETAILER:
        return `/dashboard/retailer${suffix}`;
      case UserRole.SUPPLIER:
        return `/dashboard/supplier${suffix}`;
      case UserRole.DRIVER:
        return `/dashboard/driver${suffix}`;
      case UserRole.CONSUMER:
      default:
        return `/dashboard/consumer${suffix}`;
    }
  }

  private addRecipient(
    map: Map<string, NotificationRecipient>,
    recipient: NotificationRecipient | null | undefined,
  ): void {
    if (recipient?.userId) map.set(recipient.userId, recipient);
  }

  private async addUserRecipient(
    map: Map<string, NotificationRecipient>,
    userId: string | null | undefined,
    businessId?: string | null,
  ): Promise<void> {
    if (!userId) return;
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, phoneE164: true, isActive: true },
    });
    if (!user?.isActive) return;
    this.addRecipient(map, {
      userId: user.id,
      role: user.role,
      businessId: businessId ?? null,
      phoneE164: user.phoneE164,
    });
  }

  private async addBusinessOwnerRecipient(
    map: Map<string, NotificationRecipient>,
    businessId: string | null | undefined,
  ): Promise<void> {
    if (!businessId) return;
    const profile = await this.prismaService.businessProfile.findUnique({
      where: { id: businessId },
      select: { ownerUserId: true },
    });
    await this.addUserRecipient(map, profile?.ownerUserId, businessId);
  }

  private async addRoleRecipients(
    map: Map<string, NotificationRecipient>,
    role: UserRole,
  ): Promise<void> {
    const users = await this.prismaService.user.findMany({
      where: { role, isActive: true },
      select: { id: true, phoneE164: true },
    });
    for (const user of users) {
      this.addRecipient(map, {
        userId: user.id,
        role,
        businessId: null,
        phoneE164: user.phoneE164,
      });
    }
  }

  private roleDeepLinks(
    recipients: NotificationRecipient[],
    options?: { orderRef?: string | null; orderId?: string | null; tab?: string | null },
  ): string[] {
    return Array.from(
      new Set(recipients.map((recipient) => this.deepLinkForRole(recipient.role, options))),
    );
  }

  private async buildNotification(
    eventType: string,
    payload: Record<string, any>,
    outboxEventId: string,
  ): Promise<UserNotificationInput | null> {
    const recipients = new Map<string, NotificationRecipient>();
    let title = '';
    let body = '';
    let dedupeKey = '';
    let category = 'ORDER_UPDATE';
    let smsMessage: string | undefined;
    const smsRecipientUserIds: string[] = [];
    let metadata: Prisma.InputJsonValue = payload as Prisma.InputJsonValue;
    let deepLinkTab: string | null = null;
    let deepLinkOrderRef: string | null = null;
    let deepLinkOrderId: string | null = null;

    const addSmsUser = (userId: string | undefined): void => {
      if (userId) smsRecipientUserIds.push(userId);
    };

    if (
      eventType === 'ManagedOrderRoutedEvent' ||
      eventType === 'DirectMerchantOrderPlacedEvent'
    ) {
      const orderRef = payload.orderRef ?? payload.orderRef8 ?? 'ORDER';
      const totalTzs = payload.expectedTotalTzs ?? 0;
      title = `Oda Mpya #${orderRef}`;
      body = `Oda #${orderRef} imepokelewa. Jumla: TZS ${totalTzs}.`;
      dedupeKey = `order-placed:${payload.orderId ?? orderRef}`;
      deepLinkTab = 'orders';
      deepLinkOrderRef = String(orderRef);
      deepLinkOrderId = payload.orderId ? String(payload.orderId) : null;
      if (eventType === 'ManagedOrderRoutedEvent') {
        await this.addRoleRecipients(recipients, UserRole.SUPER_ADMIN);
      }
      await this.addBusinessOwnerRecipient(recipients, payload.sellerBusinessId);
      await this.addUserRecipient(recipients, payload.buyerUserId, payload.sellerBusinessId);
      const sellerRecipient = payload.sellerBusinessId
        ? await this.prismaService.businessProfile.findUnique({
            where: { id: payload.sellerBusinessId },
            select: { ownerUserId: true },
          })
        : null;
      addSmsUser(sellerRecipient?.ownerUserId);
      addSmsUser(payload.buyerUserId);
      smsMessage = `SokoKuu: Oda #${orderRef} imepokelewa. Jumla TZS ${totalTzs}.`;
    } else if (eventType === 'OrderDispatchedEvent') {
      const orderRef = payload.orderRef ?? payload.orderRef8 ?? 'ORDER';
      const order = payload.orderId
        ? await this.prismaService.order.findUnique({
            where: { id: payload.orderId },
            select: { buyerUserId: true, sellerBusinessId: true },
          })
        : null;
      title = `Oda Imetumwa #${orderRef}`;
      body = `Oda #${orderRef} iko njiani kwa mteja.`;
      dedupeKey = `order-dispatched:${payload.orderId ?? orderRef}`;
      deepLinkTab = 'orders';
      deepLinkOrderRef = String(orderRef);
      deepLinkOrderId = payload.orderId ? String(payload.orderId) : null;
      await this.addUserRecipient(recipients, order?.buyerUserId ?? payload.buyerUserId, order?.sellerBusinessId ?? payload.sellerBusinessId);
      await this.addUserRecipient(recipients, payload.driverUserId, payload.sellerBusinessId);
      await this.addBusinessOwnerRecipient(recipients, order?.sellerBusinessId ?? payload.sellerBusinessId);
      addSmsUser(order?.buyerUserId ?? payload.buyerUserId);
      addSmsUser(payload.driverUserId);
      smsMessage = `SokoKuu: Oda #${orderRef} imetumwa, iko njiani.`;
    } else if (eventType === 'OrderDeliveredEvent') {
      const orderRef = payload.orderRef ?? payload.orderRef8 ?? 'ORDER';
      title = `Oda Imeletwa #${orderRef}`;
      body = `Oda #${orderRef} imefika na imethibitishwa. Asante!`;
      dedupeKey = `order-delivered:${payload.orderId ?? orderRef}`;
      deepLinkTab = 'orders';
      deepLinkOrderRef = String(orderRef);
      deepLinkOrderId = payload.orderId ? String(payload.orderId) : null;
      await this.addUserRecipient(recipients, payload.buyerUserId, payload.sellerBusinessId);
      await this.addUserRecipient(recipients, payload.driverUserId, payload.sellerBusinessId);
      await this.addBusinessOwnerRecipient(recipients, payload.sellerBusinessId);
      addSmsUser(payload.buyerUserId);
      addSmsUser(payload.driverUserId);
      smsMessage = `SokoKuu: Oda #${orderRef} imefika. Asante!`;
    } else if (eventType === 'DeliveryDisputeEvent') {
      const orderRef = payload.orderRef ?? payload.orderRef8 ?? 'ORDER';
      const order = payload.orderId
        ? await this.prismaService.order.findUnique({
            where: { id: payload.orderId },
            select: { buyerUserId: true, sellerBusinessId: true },
          })
        : null;
      category = 'DISPUTE_ALERT';
      title = `Mgogoro wa Uwasilishaji #${orderRef}`;
      body = `Oda #${orderRef} imegombana wakati wa uwasilishaji. Inahitaji uhakiki.`;
      dedupeKey = `delivery-dispute:${payload.orderId ?? orderRef}`;
      deepLinkTab = 'orders';
      deepLinkOrderRef = String(orderRef);
      deepLinkOrderId = payload.orderId ? String(payload.orderId) : null;
      await this.addRoleRecipients(recipients, UserRole.SUPER_ADMIN);
      await this.addUserRecipient(recipients, order?.buyerUserId, order?.sellerBusinessId ?? payload.sellerBusinessId);
      await this.addUserRecipient(recipients, payload.driverUserId, payload.sellerBusinessId);
      await this.addBusinessOwnerRecipient(recipients, order?.sellerBusinessId ?? payload.sellerBusinessId);
      addSmsUser(payload.driverUserId);
      smsMessage = `SokoKuu: Mgogoro wa oda #${orderRef}. Tafadhali angalia dashibodi.`;
    } else if (eventType === 'OrderCancelledEvent') {
      const orderRef = payload.orderRef ?? payload.orderRef8 ?? 'ORDER';
      const order = payload.orderId
        ? await this.prismaService.order.findUnique({
            where: { id: payload.orderId },
            select: { buyerUserId: true, sellerBusinessId: true },
          })
        : null;
      title = `Oda Imefutwa #${orderRef}`;
      body = `Oda #${orderRef} imefutwa. Sababu: ${payload.reason ?? 'Haijatajwa'}.`;
      dedupeKey = `order-cancelled:${payload.orderId ?? orderRef}`;
      deepLinkTab = 'orders';
      deepLinkOrderRef = String(orderRef);
      deepLinkOrderId = payload.orderId ? String(payload.orderId) : null;
      await this.addUserRecipient(recipients, order?.buyerUserId, order?.sellerBusinessId ?? payload.sellerBusinessId);
      await this.addBusinessOwnerRecipient(recipients, order?.sellerBusinessId ?? payload.sellerBusinessId);
    } else if (
      eventType === 'SupplierExternalPurchaseReceivedEvent' ||
      eventType === 'SupplierStockInRecordedEvent' ||
      eventType === 'SupplierListingPublishedEvent' ||
      eventType === 'SupplierAdminReceiveToggledEvent' ||
      (eventType === 'GlobalCatalogClonedBaseZeroEvent' && payload.supplierBusinessId)
    ) {
      category = eventType === 'SupplierAdminReceiveToggledEvent' ? 'PERMISSION_UPDATE' : 'SUPPLIER_UPDATE';
      const supplierId = payload.supplierBusinessId;
      const canonicalSku = payload.canonicalSku ?? payload.globalCatalogId ?? 'SKU';
      if (eventType === 'SupplierExternalPurchaseReceivedEvent') {
        title = 'Risiti ya Manunuzi Imesajiliwa';
        body = `Manunuzi ya ${payload.supplierName ?? 'msambazaji'} yamesajiliwa kwa ${payload.receivedQuanta ?? 0} Quarter-Quanta.`;
      } else if (eventType === 'SupplierStockInRecordedEvent') {
        title = 'Stok ya Ghala Imeongezwa';
        body = `Vipimo ${payload.quantityQuanta ?? 0} Quarter-Quanta vimeongezwa kwenye ghala lako.`;
      } else if (eventType === 'SupplierListingPublishedEvent') {
        title = 'Orodha ya Sokoni Imeshareshwa';
        body = `SKU ${canonicalSku} sasa inapatikana kwa wauzaji wa jumla.`;
      } else if (eventType === 'SupplierAdminReceiveToggledEvent') {
        title = payload.allowAdminReceive
          ? 'Ruhusa ya Admin Kupokea Oda IMEWASHWA'
          : 'Ruhusa ya Admin Kupokea Oda IMEZIMWA';
        body = payload.allowAdminReceive
          ? 'Dawati la Super Admin sasa linaweza kupokea na kuelekeza oda zako.'
          : 'Dawati la Super Admin halitaipokeya oda zako kiotomatiki.';
      } else {
        title = 'SKU Imenakiliwa Ghala';
        body = `SKU ${canonicalSku} imeongezwa kwenye ghala lako kwa stok 0 na bei 0 TZS.`;
      }
      dedupeKey = `${eventType}:${payload.listingId ?? payload.receiptId ?? payload.productId ?? payload.globalCatalogId ?? supplierId ?? outboxEventId}`;
      if (eventType !== 'SupplierAdminReceiveToggledEvent') {
        deepLinkTab = 'warehouse';
      }
      await this.addBusinessOwnerRecipient(recipients, supplierId);
      if (eventType === 'SupplierAdminReceiveToggledEvent') {
        await this.addRoleRecipients(recipients, UserRole.SUPER_ADMIN);
      }
      const owner = supplierId
        ? await this.prismaService.businessProfile.findUnique({
            where: { id: supplierId },
            select: { ownerUserId: true },
          })
        : null;
      addSmsUser(owner?.ownerUserId);
      smsMessage = `SokoKuu: ${title}. ${body}`;
    } else {
      return null;
    }

    if (recipients.size === 0) return null;

    const recipientList = Array.from(recipients.values());
    const deepLinkOptions = {
      tab: deepLinkTab,
      orderRef: deepLinkOrderRef,
      orderId: deepLinkOrderId,
    };
    const deepLinks = this.roleDeepLinks(recipientList, deepLinkOptions);

    return {
      eventType,
      category,
      title,
      body,
      deepLink: deepLinks[0] ?? '/dashboard',
      deepLinksByRole: Object.fromEntries(
        recipientList.map((recipient) => [
          recipient.role,
          this.deepLinkForRole(recipient.role, deepLinkOptions),
        ]),
      ) as Partial<Record<UserRole, string>>,
      metadata: {
        ...(metadata as Record<string, unknown>),
        deepLinks,
        outboxEventId,
        orderRef: deepLinkOrderRef,
        orderId: deepLinkOrderId,
      },
      dedupeKey,
      recipients: recipientList,
      smsMessage,
      smsRecipientUserIds,
      outboxEventId,
    };
  }
}
