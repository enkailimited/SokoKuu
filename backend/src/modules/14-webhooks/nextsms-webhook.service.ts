import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { PricingRoutingEngine } from '@modules/07-pricing/pricing-routing.engine';
import { assertValidOrderTransition } from '@modules/09-orders/order-state.policy';
import { OutboundSmsService } from '@modules/13-notifications/outbound-sms.service';
import {
  normalizeTanzanianPhoneE164,
  parseCompactSmsCommand,
  verifyCompactSmsSig6,
} from './compact-sms.parser';
import { NextSmsIncomingDto } from './dto/nextsms-webhook.dto';

interface LockedCancelOrderRow {
  id: string;
  order_ref: string;
  buyer_user_id: string;
  seller_business_id: string;
  driver_user_id: string | null;
  status: OrderStatus;
  expected_total_tzs: bigint;
}

@Injectable()
export class NextSmsWebhookService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
    private readonly pricingEngine: PricingRoutingEngine,
    private readonly outboundSmsService: OutboundSmsService,
  ) {}

  async handleInboundSms(dto: NextSmsIncomingDto, ipAddress?: string) {
    const senderPhoneE164 = normalizeTanzanianPhoneE164(dto.from);
    const rawMessage = dto.text.trim().slice(0, 160);
    const parsed = parseCompactSmsCommand(rawMessage);

    // 1. Replay/idempotency check by messageId or (orderRef8 + parsedAction)
    if (dto.messageId) {
      const existingByMsgId = await this.prismaService.nextSmsInboundLog.findUnique({
        where: { messageId: dto.messageId },
      });
      if (existingByMsgId) {
        return {
          status: 'DUPLICATE_IGNORED',
          idempotentReplay: true,
          action: existingByMsgId.parsedAction,
          orderRef8: existingByMsgId.orderRef8,
          orderId: existingByMsgId.orderId,
        };
      }
    }

    const existingProcessed = await this.prismaService.nextSmsInboundLog.findFirst({
      where: {
        orderRef8: parsed.orderRef8,
        parsedAction: parsed.action,
        status: 'PROCESSED',
      },
    });
    if (existingProcessed) {
      return {
        status: 'DUPLICATE_IGNORED',
        idempotentReplay: true,
        action: existingProcessed.parsedAction,
        orderRef8: existingProcessed.orderRef8,
        orderId: existingProcessed.orderId,
      };
    }

    // 2. Authenticate sender + constant-time SIG6 HMAC-SHA256 verification
    const user = await this.prismaService.user.findUnique({
      where: { phoneE164: senderPhoneE164 },
      select: {
        id: true,
        fullName: true,
        role: true,
        smsHmacSecret: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      await this.recordRejectedInbound(
        dto.messageId,
        senderPhoneE164,
        rawMessage,
        parsed.action,
        parsed.orderRef8,
        'UNKNOWN_OR_INACTIVE_SENDER',
        undefined,
        ipAddress,
      );
      throw new UnauthorizedException('Sender phone number is not registered or inactive.');
    }

    const isValidSig = verifyCompactSmsSig6(
      user.smsHmacSecret,
      parsed.signedPayload,
      parsed.sig6,
    );

    if (!isValidSig) {
      await this.recordRejectedInbound(
        dto.messageId,
        senderPhoneE164,
        rawMessage,
        parsed.action,
        parsed.orderRef8,
        'INVALID_SIG6_HMAC',
        user.id,
        ipAddress,
      );
      throw new UnauthorizedException('INVALID_NEXTSMS_HMAC_SIGNATURE');
    }

    if (parsed.action === 'ORDER') {
      return this.processCompactOrder(
        {
          messageId: dto.messageId,
          senderPhoneE164,
          rawMessage,
          senderUserId: user.id,
          orderRef8: parsed.orderRef8,
          sellerShortCode: parsed.sellerShortCode,
          items: parsed.items,
        },
      );
    }

    return this.processCompactCancel({
      messageId: dto.messageId,
      senderPhoneE164,
      rawMessage,
      senderUserId: user.id,
      orderRef8: parsed.orderRef8,
    });
  }

  private async processCompactOrder(input: {
    messageId?: string;
    senderPhoneE164: string;
    rawMessage: string;
    senderUserId: string;
    orderRef8: string;
    sellerShortCode: string;
    items: Array<{ smsItemCode: string; unitType: any; quantity: number }>;
  }) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const seller = await tx.businessProfile.findUnique({
        where: { smsShortCode: input.sellerShortCode },
        select: {
          id: true,
          businessName: true,
          isPlatformManaged: true,
        },
      });

      if (!seller) {
        throw new NotFoundException(`Seller short code ${input.sellerShortCode} was not found.`);
      }

      const itemCodes = input.items.map((i) => i.smsItemCode);
      const products = await tx.product.findMany({
        where: {
          sellerBusinessId: seller.id,
          smsItemCode: { in: itemCodes },
          isActive: true,
        },
        select: {
          id: true,
          smsItemCode: true,
        },
      });

      const codeToProductId = new Map(products.map((p) => [p.smsItemCode, p.id]));
      const quoteItems = input.items.map((item) => {
        const pid = codeToProductId.get(item.smsItemCode);
        if (!pid) {
          throw new NotFoundException(
            `Product code ${item.smsItemCode} not found for seller ${input.sellerShortCode}.`,
          );
        }
        return {
          productId: pid,
          unitType: item.unitType,
          quantity: item.quantity,
        };
      });

      const quote = await this.pricingEngine.calculateOrderQuote(
        {
          sellerBusinessId: seller.id,
          items: quoteItems,
        },
        tx,
      );

      // Lock products & deduct Quarter-Quanta atomically
      const requiredByProduct = new Map<string, number>();
      for (const line of quote.lines) {
        requiredByProduct.set(
          line.productId,
          (requiredByProduct.get(line.productId) ?? 0) + line.totalQuarterQuanta,
        );
      }

      for (const productId of Array.from(requiredByProduct.keys()).sort()) {
        const neededQuanta = requiredByProduct.get(productId) ?? 0;
        const lockedRows = await tx.$queryRaw<
          Array<{ base_quarter_quanta_stock: number; sealed_bulk_packages_stock: number }>
        >`
          SELECT base_quarter_quanta_stock, sealed_bulk_packages_stock
            FROM products
           WHERE id = ${productId}::uuid
             FOR UPDATE
        `;
        let currentLoose = Number(lockedRows[0]?.base_quarter_quanta_stock ?? 0);

        if (currentLoose < neededQuanta) {
          await tx.$executeRaw`
            CALL auto_break_bulk_package(${productId}::uuid, ${neededQuanta}::integer)
          `;
          const refreshed = await tx.$queryRaw<Array<{ base_quarter_quanta_stock: number }>>`
            SELECT base_quarter_quanta_stock FROM products WHERE id = ${productId}::uuid
          `;
          currentLoose = Number(refreshed[0]?.base_quarter_quanta_stock ?? 0);
        }

        if (currentLoose < neededQuanta) {
          throw new ConflictException(`Insufficient inventory for SMS item ${productId}.`);
        }

        const remaining = currentLoose - neededQuanta;
        await tx.$executeRaw`
          UPDATE products
             SET base_quarter_quanta_stock = ${remaining}::integer,
                 version = version + 1,
                 updated_at = NOW()
           WHERE id = ${productId}::uuid
        `;
      }

      const routingOutputCode = seller.isPlatformManaged
        ? 'ROUTED_PLATFORM_MANAGED_HELPDESK'
        : 'ROUTED_DIRECT_MERCHANT_DB';
      const targetPipeline = seller.isPlatformManaged
        ? 'SUPER_ADMIN_HELPDESK_PIPELINE'
        : 'WHOLESALER_VENDOR_TERMINAL';

      const orderId = randomUUID();
      const createdOrder = await tx.order.create({
        data: {
          id: orderId,
          orderRef: input.orderRef8,
          buyerUserId: input.senderUserId,
          sellerBusinessId: seller.id,
          status: 'PLACED',
          originChannel: 'NEXTSMS_INBOUND',
          routingTargetPipeline: targetPipeline,
          rawSmsPayload: input.rawMessage,
          expectedTotalTzs: BigInt(quote.expectedTotalTzs),
          deliveryFeeTzs: 0n,
          paymentMethod: 'CASH',
          paidAmountTzs: 0n,
        },
        select: { id: true, orderRef: true },
      });

      await tx.orderItem.createMany({
        data: quote.lines.map((line) => ({
          orderId: createdOrder.id,
          productId: line.productId,
          unitType: line.unitType,
          quantity: line.quantity,
          baseUnitsTotal: line.totalQuarterQuanta,
          unitPriceTzs: BigInt(line.unitPriceTzs),
          lineTotalTzs: BigInt(line.lineTotalTzs),
          isWholesaleTierApplied: line.isWholesaleTierApplied,
        })),
      });

      await tx.orderDispatchAuditTrace.create({
        data: {
          orderId: createdOrder.id,
          orderRef8: input.orderRef8,
          sellerBusinessId: seller.id,
          isPlatformManagedSnapshot: seller.isPlatformManaged,
          routingOutputCode,
          targetPipeline,
          txIsolationLevel: 'SERIALIZABLE',
          helpdeskStatus: seller.isPlatformManaged ? 'OPEN' : 'DIRECT_MERCHANT',
        },
      });

      await tx.nextSmsInboundLog.create({
        data: {
          messageId: input.messageId ?? null,
          senderPhoneE164: input.senderPhoneE164,
          rawMessage: input.rawMessage,
          parsedAction: 'ORDER',
          orderRef8: input.orderRef8,
          isValidHmac: true,
          orderId: createdOrder.id,
          status: 'PROCESSED',
        },
      });

      if (tx.financialAuditLog && typeof tx.financialAuditLog.create === 'function') {
        await tx.financialAuditLog.create({
          data: {
            actorUserId: input.senderUserId,
            sellerBusinessId: seller.id,
            orderId: createdOrder.id,
            eventType: 'NEXTSMS_ORDER_CREATED',
            amountTzs: BigInt(quote.expectedTotalTzs),
            newState: 'PLACED',
            details: {
              orderRef8: input.orderRef8,
              routingOutputCode,
            },
          },
        });
      }

      const outbox = await this.outboxService.enqueue(
        {
          aggregateType: 'Order',
          aggregateId: createdOrder.id,
          eventType: seller.isPlatformManaged
            ? 'ManagedOrderRoutedEvent'
            : 'DirectMerchantOrderPlacedEvent',
          routingKey: seller.isPlatformManaged
            ? 'admin.managed.order_routed'
            : 'merchant.direct.order_placed',
          payload: {
            orderId: createdOrder.id,
            orderRef: input.orderRef8,
            originChannel: 'NEXTSMS_INBOUND',
            expectedTotalTzs: quote.expectedTotalTzs,
          },
        },
        tx,
      );

      if (tx.smsDeliveryLog && typeof tx.smsDeliveryLog.create === 'function') {
        const confirmSms = `SokoKuu: Oda #${input.orderRef8} imepokelewa. Jumla: TZS ${quote.expectedTotalTzs}. Asante!`.slice(
          0,
          160,
        );
        await this.outboundSmsService.queueAndDispatchSms(
          {
            recipientPhoneE164: input.senderPhoneE164,
            messageBody: confirmSms,
            outboxEventId: outbox.id,
          },
          tx,
        );
      }

      return {
        status: 'PROCESSED',
        idempotentReplay: false,
        action: 'ORDER',
        orderId: createdOrder.id,
        orderRef8: input.orderRef8,
        expectedTotalTzs: quote.expectedTotalTzs,
        routingOutputCode,
      };
    });
  }

  private async processCompactCancel(input: {
    messageId?: string;
    senderPhoneE164: string;
    rawMessage: string;
    senderUserId: string;
    orderRef8: string;
  }) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const lockedOrders = await tx.$queryRaw<LockedCancelOrderRow[]>`
        SELECT id::text AS id,
               order_ref,
               buyer_user_id::text AS buyer_user_id,
               seller_business_id::text AS seller_business_id,
               driver_user_id::text AS driver_user_id,
               status,
               expected_total_tzs
          FROM orders
         WHERE order_ref = ${input.orderRef8}
           FOR UPDATE
      `;

      const order = lockedOrders[0];
      if (!order) {
        throw new NotFoundException(`Order ${input.orderRef8} was not found.`);
      }

      const seller = await tx.businessProfile.findUnique({
        where: { id: order.seller_business_id },
        select: { ownerUserId: true },
      });

      const isAuthorizedCancelActor =
        order.driver_user_id === input.senderUserId ||
        seller?.ownerUserId === input.senderUserId;

      if (!isAuthorizedCancelActor) {
        throw new ForbiddenException(
          'Only the assigned DRIVER or owning WHOLESALER may cancel via SK#CANCEL SMS.',
        );
      }

      if (order.status === 'DELIVERED') {
        throw new ConflictException(
          'Cannot cancel an order that is already DELIVERED via SMS.',
        );
      }

      if (order.status === 'CANCELLED') {
        return {
          status: 'DUPLICATE_IGNORED',
          idempotentReplay: true,
          action: 'CANCEL',
          orderRef8: input.orderRef8,
          orderId: order.id,
        };
      }

      assertValidOrderTransition(order.status, 'CANCELLED');

      const items = await tx.orderItem.findMany({
        where: { orderId: order.id },
        select: { productId: true, baseUnitsTotal: true },
        orderBy: { productId: 'asc' },
      });

      for (const item of items) {
        await tx.$queryRaw`
          SELECT id FROM products WHERE id = ${item.productId}::uuid FOR UPDATE
        `;
        await tx.$executeRaw`
          UPDATE products
             SET base_quarter_quanta_stock = base_quarter_quanta_stock + ${item.baseUnitsTotal}::integer,
                 version = version + 1,
                 updated_at = NOW()
           WHERE id = ${item.productId}::uuid
        `;
      }

      await tx.$executeRaw`
        UPDATE orders
           SET status = 'CANCELLED'::order_status,
               cancelled_at = NOW(),
               cancellation_reason = 'Cancelled via NextSMS doorstep command',
               version = version + 1
         WHERE id = ${order.id}::uuid
      `;

      await tx.$executeRaw`
        UPDATE cash_delivery_ledgers
           SET verification_status = 'DISPUTED'::ledger_verification_status,
               version = version + 1,
               updated_at = NOW()
         WHERE order_id = ${order.id}::uuid
      `;

      await tx.nextSmsInboundLog.create({
        data: {
          messageId: input.messageId ?? null,
          senderPhoneE164: input.senderPhoneE164,
          rawMessage: input.rawMessage,
          parsedAction: 'CANCEL',
          orderRef8: input.orderRef8,
          isValidHmac: true,
          orderId: order.id,
          status: 'PROCESSED',
        },
      });

      if (tx.financialAuditLog && typeof tx.financialAuditLog.create === 'function') {
        await tx.financialAuditLog.create({
          data: {
            actorUserId: input.senderUserId,
            sellerBusinessId: order.seller_business_id,
            orderId: order.id,
            eventType: 'NEXTSMS_DOORSTEP_CANCEL_DISPUTE',
            amountTzs: BigInt(order.expected_total_tzs),
            previousState: order.status,
            newState: 'CANCELLED',
            details: {
              orderRef8: input.orderRef8,
              ledgerVerificationStatus: 'DISPUTED',
            },
          },
        });
      }

      await this.outboxService.enqueue(
        {
          aggregateType: 'Order',
          aggregateId: order.id,
          eventType: 'DeliveryDisputeEvent',
          routingKey: 'cod.dispute.recorded',
          payload: {
            orderId: order.id,
            orderRef8: input.orderRef8,
            driverUserId: order.driver_user_id,
            sellerBusinessId: order.seller_business_id,
            reason: 'NEXTSMS_DOORSTEP_CANCEL',
          },
        },
        tx,
      );

      return {
        status: 'PROCESSED',
        idempotentReplay: false,
        action: 'CANCEL',
        orderId: order.id,
        orderRef8: input.orderRef8,
        orderStatus: 'CANCELLED',
        ledgerVerificationStatus: 'DISPUTED',
      };
    });
  }

  private async recordRejectedInbound(
    messageId: string | undefined,
    senderPhoneE164: string,
    rawMessage: string,
    parsedAction: string,
    orderRef8: string,
    errorCode: string,
    userId?: string,
    ipAddress?: string,
  ): Promise<void> {
    if (
      this.prismaService.nextSmsInboundLog &&
      typeof this.prismaService.nextSmsInboundLog.create === 'function'
    ) {
      await this.prismaService.nextSmsInboundLog
        .create({
          data: {
            messageId: messageId ?? null,
            senderPhoneE164,
            rawMessage,
            parsedAction,
            orderRef8,
            isValidHmac: false,
            status: 'REJECTED',
            errorCode,
          },
        })
        .catch(() => undefined);
    }

    if (
      this.prismaService.securityAuditLog &&
      typeof this.prismaService.securityAuditLog.create === 'function'
    ) {
      await this.prismaService.securityAuditLog
        .create({
          data: {
            userId: userId ?? null,
            eventType: 'NEXTSMS_WEBHOOK_SECURITY_REJECTED',
            ipAddress: ipAddress ?? null,
            details: {
              senderPhoneE164,
              parsedAction,
              orderRef8,
              errorCode,
            },
          },
        })
        .catch(() => undefined);
    }
  }
}
