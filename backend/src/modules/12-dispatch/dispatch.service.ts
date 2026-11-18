import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { assertValidOrderTransition } from '@modules/09-orders/order-state.policy';
import {
  generateOneTimeQrToken,
  signQrTokenPayload,
} from '@modules/11-cod-verification/qr-crypto.util';
import { DispatchOrderDto } from './dto/dispatch.dto';

interface LockedDispatchOrderRow {
  id: string;
  order_ref: string;
  buyer_user_id: string;
  seller_business_id: string;
  driver_user_id: string | null;
  status: OrderStatus;
  expected_total_tzs: bigint;
  payment_method: string;
}

interface LockedArrivalLedgerRow {
  id: string;
  order_id: string;
  driver_user_id: string | null;
  is_qr_token_consumed: boolean;
  verification_status: string;
}

@Injectable()
export class DispatchService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService,
  ) {}

  async dispatchOrderAndAllocatePins(
    orderId: string,
    dto: DispatchOrderDto,
    user: AuthenticatedUser,
    tenantContext?: TenantContext,
  ) {
    const buyerPinPlain = String(randomInt(1000, 10000));
    const driverPinPlain = String(randomInt(1000, 10000));

    const [buyerPinHash, driverPinHash] = await Promise.all([
      argon2.hash(buyerPinPlain, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      }),
      argon2.hash(driverPinPlain, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      }),
    ]);

    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const lockedOrders = await tx.$queryRaw<LockedDispatchOrderRow[]>`
        SELECT id::text AS id,
               order_ref,
               buyer_user_id::text AS buyer_user_id,
               seller_business_id::text AS seller_business_id,
               driver_user_id::text AS driver_user_id,
               status,
               expected_total_tzs,
               payment_method
          FROM orders
         WHERE id = ${orderId}::uuid
           FOR UPDATE
      `;

      const order = lockedOrders[0];
      if (!order) {
        throw new NotFoundException(`Order ${orderId} was not found.`);
      }

      const isAuthorized =
        user.role === Role.SUPER_ADMIN ||
        ((user.role === Role.WHOLESALER || user.role === Role.RETAILER) &&
          tenantContext?.businessId === order.seller_business_id) ||
        (user.role === Role.DRIVER &&
          (!order.driver_user_id || order.driver_user_id === user.sub));

      if (!isAuthorized) {
        throw new ForbiddenException('Not authorized to dispatch this order.');
      }

      assertValidOrderTransition(order.status, 'DISPATCHED');

      const assignedDriverId =
        dto.driverUserId ??
        order.driver_user_id ??
        (user.role === Role.DRIVER ? user.sub : null);

      await tx.$executeRaw`
        UPDATE orders
           SET status = 'DISPATCHED'::order_status,
               driver_user_id = ${assignedDriverId}::uuid,
               dispatched_at = NOW(),
               version = version + 1
         WHERE id = ${orderId}::uuid
      `;

      const ledger = await tx.cashDeliveryLedger.upsert({
        where: { orderId },
        create: {
          orderId,
          driverUserId: assignedDriverId,
          buyerConfirmationPin: buyerPinHash,
          driverConfirmationPin: driverPinHash,
          expectedCashAmount: BigInt(order.expected_total_tzs),
          collectedCashAmount: 0n,
          paymentMethod: order.payment_method,
          verificationStatus: 'WAITING',
        },
        update: {
          driverUserId: assignedDriverId,
          buyerConfirmationPin: buyerPinHash,
          driverConfirmationPin: driverPinHash,
          expectedCashAmount: BigInt(order.expected_total_tzs),
          verificationStatus: 'WAITING',
          version: { increment: 1 },
        },
        select: { id: true },
      });

      if (tx.financialAuditLog && typeof tx.financialAuditLog.create === 'function') {
        await tx.financialAuditLog.create({
          data: {
            actorUserId: user.sub,
            sellerBusinessId: order.seller_business_id,
            orderId: order.id,
            eventType: 'ORDER_DISPATCHED_PIN_ALLOCATED',
            amountTzs: BigInt(order.expected_total_tzs),
            previousState: order.status,
            newState: 'DISPATCHED',
            details: {
              orderRef: order.order_ref,
              ledgerId: ledger.id,
              assignedDriverId,
            },
          },
        });
      }

      await this.outboxService.enqueue(
        {
          aggregateType: 'Order',
          aggregateId: order.id,
          eventType: 'OrderDispatchedEvent',
          routingKey: 'orders.dispatch.allocated',
          payload: {
            orderId: order.id,
            orderRef: order.order_ref,
            sellerBusinessId: order.seller_business_id,
            driverUserId: assignedDriverId,
            expectedCashAmountTzs: Number(order.expected_total_tzs),
          },
        },
        tx,
      );

      return {
        orderId: order.id,
        orderRef: order.order_ref,
        ledgerId: ledger.id,
        driverUserId: assignedDriverId,
        status: 'DISPATCHED' as const,
        expectedCashAmountTzs: Number(order.expected_total_tzs),
        // Plaintext PINs issued ONCE on allocation (never persisted in plain form)
        buyerConfirmationPin: buyerPinPlain,
        driverConfirmationPin: driverPinPlain,
        dispatchedAtEat: new Date().toISOString(),
      };
    });
  }

  async issueDriverArrivalQr(orderId: string, user: AuthenticatedUser) {
    const qrToken = generateOneTimeQrToken();
    const ttlSeconds = this.configService.get<number>('QR_TOKEN_TTL_SECONDS') ?? 300;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const expiresAtIso = expiresAt.toISOString();
    const qrSecret =
      this.configService.get<string>('QR_TOKEN_HMAC_SECRET') ??
      this.configService.get<string>('JWT_ACCESS_SECRET')!;
    const qrSignature = signQrTokenPayload(qrSecret, orderId, qrToken, expiresAtIso);

    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const orders = await tx.$queryRaw<LockedDispatchOrderRow[]>`
        SELECT id::text AS id,
               order_ref,
               buyer_user_id::text AS buyer_user_id,
               seller_business_id::text AS seller_business_id,
               driver_user_id::text AS driver_user_id,
               status,
               expected_total_tzs,
               payment_method
          FROM orders
         WHERE id = ${orderId}::uuid
           FOR UPDATE
      `;

      const order = orders[0];
      if (!order) {
        throw new NotFoundException(`Order ${orderId} was not found.`);
      }

      if (user.role !== Role.SUPER_ADMIN && order.driver_user_id !== user.sub) {
        throw new ForbiddenException('Only the assigned driver can issue an arrival QR token.');
      }

      if (order.status !== 'DISPATCHED') {
        throw new ConflictException(
          `Order must be in DISPATCHED status to issue arrival QR (current=${order.status}).`,
        );
      }

      const ledgers = await tx.$queryRaw<LockedArrivalLedgerRow[]>`
        SELECT id::text AS id,
               order_id::text AS order_id,
               driver_user_id::text AS driver_user_id,
               is_qr_token_consumed,
               verification_status
          FROM cash_delivery_ledgers
         WHERE order_id = ${orderId}::uuid
           FOR UPDATE
      `;

      const ledger = ledgers[0];
      if (!ledger) {
        throw new NotFoundException(`Cash delivery ledger for order ${orderId} was not found.`);
      }

      if (ledger.is_qr_token_consumed) {
        throw new ConflictException('ERROR_QR_CODE_ALREADY_CONSUMED');
      }

      await tx.$executeRaw`
        UPDATE cash_delivery_ledgers
           SET one_time_qr_token = ${qrToken},
               qr_token_expires_at = ${expiresAt}::timestamptz,
               qr_token_signature = ${qrSignature},
               is_qr_token_consumed = FALSE,
               driver_user_id = COALESCE(driver_user_id, ${user.sub}::uuid),
               version = version + 1,
               updated_at = NOW()
         WHERE id = ${ledger.id}::uuid
      `;

      return {
        orderId: order.id,
        orderRef: order.order_ref,
        oneTimeQrToken: qrToken,
        qrSignature,
        expiresAt: expiresAtIso,
        ttlSeconds,
        isQrTokenConsumed: false,
      };
    });
  }

  async getDriverQueue(user: AuthenticatedUser) {
    const whereClause =
      user.role === Role.SUPER_ADMIN
        ? { status: { in: ['PLACED', 'DISPATCHED'] as OrderStatus[] } }
        : {
            driverUserId: user.sub,
            status: { in: ['PLACED', 'DISPATCHED'] as OrderStatus[] },
          };

    const orders = await this.prismaService.order.findMany({
      where: whereClause,
      orderBy: { placedAt: 'desc' },
      take: 50,
      include: {
        cashLedger: {
          select: {
            verificationStatus: true,
            expectedCashAmount: true,
            isBuyerConfirmed: true,
            isDriverConfirmed: true,
            isQrTokenConsumed: true,
            qrTokenExpiresAt: true,
          },
        },
      },
    });

    return {
      count: orders.length,
      deliveries: orders.map((order) => ({
        orderId: order.id,
        orderRef: order.orderRef,
        sellerBusinessId: order.sellerBusinessId,
        buyerUserId: order.buyerUserId,
        status: order.status,
        expectedTotalTzs: Number(order.expectedTotalTzs),
        paymentMethod: order.paymentMethod,
        placedAt: order.placedAt.toISOString(),
        dispatchedAt: order.dispatchedAt?.toISOString() ?? null,
        ledger: order.cashLedger
          ? {
              verificationStatus: order.cashLedger.verificationStatus,
              expectedCashAmount: Number(order.cashLedger.expectedCashAmount),
              isBuyerConfirmed: order.cashLedger.isBuyerConfirmed,
              isDriverConfirmed: order.cashLedger.isDriverConfirmed,
              isQrTokenConsumed: order.cashLedger.isQrTokenConsumed,
              qrTokenExpiresAt: order.cashLedger.qrTokenExpiresAt?.toISOString() ?? null,
            }
          : null,
      })),
    };
  }
}
