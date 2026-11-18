import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderOrigin, OrderStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { PricingRoutingEngine } from '@modules/07-pricing/pricing-routing.engine';
import { RedisService } from '@redis/redis.service';
import { CancelOrderDto, CreateOrderRequestDto } from './dto/orders.dto';
import { assertValidOrderTransition } from './order-state.policy';

export interface OrderReceiptLineResponse {
  productId: string;
  unitType: string;
  quantity: number;
  baseUnitsTotal: number;
  unitPriceTzs: number;
  lineTotalTzs: number;
  isWholesaleTierApplied: boolean;
}

export interface OrderReceiptResponse {
  orderId: string;
  orderRef: string;
  buyerUserId: string;
  sellerBusinessId: string;
  status: OrderStatus;
  originChannel: OrderOrigin;
  routingOutputCode: 'ROUTED_PLATFORM_MANAGED_HELPDESK' | 'ROUTED_DIRECT_MERCHANT_DB';
  targetPipeline: string;
  expectedTotalTzs: number;
  deliveryFeeTzs: number;
  paymentMethod: string;
  items: OrderReceiptLineResponse[];
  idempotentReplay: boolean;
  placedAtEat: string;
}

interface LockedProductStockRow {
  id: string;
  seller_business_id: string;
  name_sw: string;
  base_quarter_quanta_stock: number;
  sealed_bulk_packages_stock: number;
  quanta_per_sealed_package: number;
}

interface LockedOrderCancelRow {
  id: string;
  order_ref: string;
  buyer_user_id: string;
  seller_business_id: string;
  driver_user_id: string | null;
  status: OrderStatus;
  expected_total_tzs: bigint;
}

function generateOrderRef8(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
    private readonly redisService: RedisService,
    private readonly pricingEngine: PricingRoutingEngine,
  ) {}

  async createOrder(
    dto: CreateOrderRequestDto,
    idempotencyKeyHeader: string | undefined,
    user: AuthenticatedUser,
    _tenantContext?: TenantContext,
  ): Promise<OrderReceiptResponse> {
    const idempotencyKey = idempotencyKeyHeader?.trim();
    if (!idempotencyKey || idempotencyKey.length < 4 || idempotencyKey.length > 120) {
      throw new BadRequestException(
        'X-Idempotency-Key header (4–120 characters) is required for order submission.',
      );
    }

    const scopeKey = `ORDER_CREATE:${user.sub}:${idempotencyKey}`;
    const canonicalPayload = JSON.stringify({
      sellerBusinessId: dto.sellerBusinessId,
      originChannel: dto.originChannel ?? 'PWA_ONLINE',
      paymentMethod: dto.paymentMethod ?? 'CASH',
      deliveryFeeTzs: dto.deliveryFeeTzs ?? 0,
      items: dto.items.map((item) => ({
        productId: item.productId,
        unitType: item.unitType,
        quantity: item.quantity,
      })),
    });
    const requestHash = createHash('sha256').update(canonicalPayload).digest('hex');

    const lockKey = `idem:lock:${scopeKey}`;
    const lockToken = randomUUID();
    const lockAcquired = await this.tryAcquireRedisLock(lockKey, lockToken, 15);
    if (!lockAcquired) {
      throw new ConflictException(
        'Concurrent duplicate order submission in progress for this X-Idempotency-Key.',
      );
    }

    try {
      return await this.prismaService.runInTransaction('Serializable', async (tx) => {
        const now = new Date();
        const existingIdem = await tx.idempotencyKey.findUnique({
          where: { scopeKey },
        });

        if (existingIdem && existingIdem.expiresAt > now) {
          if (existingIdem.requestHash !== requestHash) {
            throw new ConflictException(
              'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: X-Idempotency-Key was already used with a different order payload.',
            );
          }
          if (existingIdem.responseBody) {
            const cached = existingIdem.responseBody as unknown as OrderReceiptResponse;
            return {
              ...cached,
              idempotentReplay: true,
            };
          }
        }

        const quote = await this.pricingEngine.calculateOrderQuote(
          {
            sellerBusinessId: dto.sellerBusinessId,
            deliveryFeeTzs: dto.deliveryFeeTzs,
            items: dto.items,
          },
          tx,
        );

        // Aggregate required Quarter-Quanta per product in deterministic sorted UUID order (deadlock-free)
        const requiredByProduct = new Map<string, number>();
        for (const line of quote.lines) {
          requiredByProduct.set(
            line.productId,
            (requiredByProduct.get(line.productId) ?? 0) + line.totalQuarterQuanta,
          );
        }

        const sortedProductIds = Array.from(requiredByProduct.keys()).sort();
        for (const productId of sortedProductIds) {
          const totalNeededQuanta = requiredByProduct.get(productId) ?? 0;

          const lockedRows = await tx.$queryRaw<LockedProductStockRow[]>`
            SELECT id::text AS id,
                   seller_business_id::text AS seller_business_id,
                   name_sw,
                   base_quarter_quanta_stock,
                   sealed_bulk_packages_stock,
                   quanta_per_sealed_package
              FROM products
             WHERE id = ${productId}::uuid
               AND is_active = TRUE
               FOR UPDATE
          `;

          const locked = lockedRows[0];
          if (!locked) {
            throw new NotFoundException(`Product ${productId} was not found or is inactive.`);
          }

          let currentLoose = Number(locked.base_quarter_quanta_stock);
          const currentSealed = Number(locked.sealed_bulk_packages_stock);

          if (currentLoose < totalNeededQuanta) {
            try {
              await tx.$executeRaw`
                CALL auto_break_bulk_package(${productId}::uuid, ${totalNeededQuanta}::integer)
              `;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (message.includes('INSUFFICIENT_SEALED_BULK') || message.includes('P0002')) {
                throw new ConflictException(
                  `Insufficient inventory for product ${productId}: loose=${currentLoose} quanta, sealed=${currentSealed} packages, needed=${totalNeededQuanta} quanta.`,
                );
              }
              throw error;
            }

            const refreshedRows = await tx.$queryRaw<Array<{ base_quarter_quanta_stock: number }>>`
              SELECT base_quarter_quanta_stock
                FROM products
               WHERE id = ${productId}::uuid
            `;
            currentLoose = Number(refreshedRows[0]?.base_quarter_quanta_stock ?? 0);
          }

          if (currentLoose < totalNeededQuanta) {
            throw new ConflictException(
              `Insufficient shelf inventory for product ${productId}: available=${currentLoose}, required=${totalNeededQuanta}.`,
            );
          }

          const remainingLoose = currentLoose - totalNeededQuanta;
          await tx.$executeRaw`
            UPDATE products
               SET base_quarter_quanta_stock = ${remainingLoose}::integer,
                   version = version + 1,
                   updated_at = NOW()
             WHERE id = ${productId}::uuid
          `;
        }

        const isManaged = quote.isPlatformManaged;
        const routingOutputCode = isManaged
          ? 'ROUTED_PLATFORM_MANAGED_HELPDESK'
          : 'ROUTED_DIRECT_MERCHANT_DB';
        const targetPipeline = isManaged
          ? 'SUPER_ADMIN_HELPDESK_PIPELINE'
          : 'WHOLESALER_VENDOR_TERMINAL';

        const orderId = randomUUID();
        const orderRef = generateOrderRef8();
        const originChannel = dto.originChannel ?? 'PWA_ONLINE';
        const paymentMethod = dto.paymentMethod ?? 'CASH';

        const createdOrder = await tx.order.create({
          data: {
            id: orderId,
            orderRef,
            buyerUserId: user.sub,
            sellerBusinessId: quote.sellerBusinessId,
            status: 'PLACED',
            originChannel,
            routingTargetPipeline: targetPipeline,
            rawSmsPayload: dto.rawSmsPayload ?? null,
            expectedTotalTzs: BigInt(quote.expectedTotalTzs),
            deliveryFeeTzs: BigInt(quote.deliveryFeeTzs),
            paymentMethod,
            paidAmountTzs: 0n,
          },
          select: {
            id: true,
            orderRef: true,
            placedAt: true,
          },
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
            orderRef8: createdOrder.orderRef,
            sellerBusinessId: quote.sellerBusinessId,
            isPlatformManagedSnapshot: isManaged,
            routingOutputCode,
            targetPipeline,
            txIsolationLevel: 'SERIALIZABLE',
            helpdeskStatus: isManaged ? 'OPEN' : 'DIRECT_MERCHANT',
          },
        });

        // If buyer is a Merchant, record lastAgreedPurchasePriceTzs on matching cloned SKUs
        // WITHOUT hydrating physical shelf inventory until GOODS_RECEIVED / DELIVERED.
        if (
          tx.businessProfile &&
          typeof tx.businessProfile.findFirst === 'function' &&
          tx.product &&
          typeof tx.product.findUnique === 'function' &&
          tx.merchantClonedProduct &&
          typeof tx.merchantClonedProduct.updateMany === 'function'
        ) {
          const buyerMerchant = await tx.businessProfile.findFirst({
            where: { ownerUserId: user.sub },
            select: { id: true },
          });
          if (buyerMerchant) {
            for (const line of quote.lines) {
              const prodMeta = await tx.product.findUnique({
                where: { id: line.productId },
                select: { globalCatalogId: true },
              });
              if (prodMeta?.globalCatalogId && line.totalQuarterQuanta > 0) {
                const agreedPerQuantum = BigInt(
                  Math.round(line.lineTotalTzs / line.totalQuarterQuanta),
                );
                await tx.merchantClonedProduct.updateMany({
                  where: {
                    retailerBusinessId: buyerMerchant.id,
                    globalCatalogId: prodMeta.globalCatalogId,
                  },
                  data: {
                    lastAgreedPurchasePriceTzs: agreedPerQuantum,
                  },
                });
              }
            }
          }
        }

        if (tx.financialAuditLog && typeof tx.financialAuditLog.create === 'function') {
          await tx.financialAuditLog.create({
            data: {
              actorUserId: user.sub,
              sellerBusinessId: quote.sellerBusinessId,
              orderId: createdOrder.id,
              eventType: 'ORDER_PLACED',
              amountTzs: BigInt(quote.expectedTotalTzs),
              previousState: null,
              newState: 'PLACED',
              details: {
                orderRef: createdOrder.orderRef,
                routingOutputCode,
                paymentMethod,
                totalQuarterQuanta: quote.totalQuarterQuanta,
              },
            },
          });
        }

        await this.outboxService.enqueue(
          {
            aggregateType: 'Order',
            aggregateId: createdOrder.id,
            eventType: isManaged ? 'ManagedOrderRoutedEvent' : 'DirectMerchantOrderPlacedEvent',
            routingKey: isManaged ? 'admin.managed.order_routed' : 'merchant.direct.order_placed',
            payload: {
              orderId: createdOrder.id,
              orderRef: createdOrder.orderRef,
              sellerBusinessId: quote.sellerBusinessId,
              sellerBusinessName: quote.sellerBusinessName,
              buyerUserId: user.sub,
              routingOutputCode,
              targetPipeline,
              expectedTotalTzs: quote.expectedTotalTzs,
              totalQuarterQuanta: quote.totalQuarterQuanta,
            },
          },
          tx,
        );

        const receipt: OrderReceiptResponse = {
          orderId: createdOrder.id,
          orderRef: createdOrder.orderRef,
          buyerUserId: user.sub,
          sellerBusinessId: quote.sellerBusinessId,
          status: 'PLACED',
          originChannel,
          routingOutputCode,
          targetPipeline,
          expectedTotalTzs: quote.expectedTotalTzs,
          deliveryFeeTzs: quote.deliveryFeeTzs,
          paymentMethod,
          items: quote.lines.map((line) => ({
            productId: line.productId,
            unitType: line.unitType,
            quantity: line.quantity,
            baseUnitsTotal: line.totalQuarterQuanta,
            unitPriceTzs: line.unitPriceTzs,
            lineTotalTzs: line.lineTotalTzs,
            isWholesaleTierApplied: line.isWholesaleTierApplied,
          })),
          idempotentReplay: false,
          placedAtEat: createdOrder.placedAt.toISOString(),
        };

        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await tx.idempotencyKey.upsert({
          where: { scopeKey },
          create: {
            scopeKey,
            requestHash,
            responseCode: 201,
            responseBody: receipt as unknown as Prisma.InputJsonValue,
            expiresAt,
          },
          update: {
            responseCode: 201,
            responseBody: receipt as unknown as Prisma.InputJsonValue,
            expiresAt,
          },
        });

        return receipt;
      });
    } finally {
      await this.releaseRedisLock(lockKey, lockToken);
    }
  }

  async cancelOrder(
    orderId: string,
    dto: CancelOrderDto,
    user: AuthenticatedUser,
    tenantContext?: TenantContext,
  ) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const lockedOrders = await tx.$queryRaw<LockedOrderCancelRow[]>`
        SELECT id::text AS id,
               order_ref,
               buyer_user_id::text AS buyer_user_id,
               seller_business_id::text AS seller_business_id,
               driver_user_id::text AS driver_user_id,
               status,
               expected_total_tzs
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
        order.buyer_user_id === user.sub ||
        order.driver_user_id === user.sub ||
        (tenantContext?.businessId && order.seller_business_id === tenantContext.businessId);

      if (!isAuthorized) {
        throw new ForbiddenException('You are not authorized to cancel this order.');
      }

      assertValidOrderTransition(order.status, 'CANCELLED');

      const items = await tx.orderItem.findMany({
        where: { orderId },
        select: {
          productId: true,
          baseUnitsTotal: true,
        },
        orderBy: { productId: 'asc' },
      });

      // Aggregate and restore reserved Quarter-Quanta atomically in sorted order
      const restoreByProduct = new Map<string, number>();
      for (const item of items) {
        restoreByProduct.set(
          item.productId,
          (restoreByProduct.get(item.productId) ?? 0) + item.baseUnitsTotal,
        );
      }

      for (const [productId, restoreQuanta] of restoreByProduct.entries()) {
        await tx.$queryRaw`
          SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE
        `;
        await tx.$executeRaw`
          UPDATE products
             SET base_quarter_quanta_stock = base_quarter_quanta_stock + ${restoreQuanta}::integer,
                 version = version + 1,
                 updated_at = NOW()
           WHERE id = ${productId}::uuid
        `;
      }

      const reason = dto.reason?.trim() || 'Cancelled by authorized participant';
      await tx.$executeRaw`
        UPDATE orders
           SET status = 'CANCELLED'::order_status,
               cancelled_at = NOW(),
               cancellation_reason = ${reason},
               version = version + 1
         WHERE id = ${orderId}::uuid
      `;

      await tx.$executeRaw`
        UPDATE cash_delivery_ledgers
           SET verification_status = 'DISPUTED'::ledger_verification_status,
               version = version + 1,
               updated_at = NOW()
         WHERE order_id = ${orderId}::uuid
      `;

      if (tx.financialAuditLog && typeof tx.financialAuditLog.create === 'function') {
        await tx.financialAuditLog.create({
          data: {
            actorUserId: user.sub,
            sellerBusinessId: order.seller_business_id,
            orderId: order.id,
            eventType: 'ORDER_CANCELLED_STOCK_RESTORED',
            amountTzs: BigInt(order.expected_total_tzs),
            previousState: order.status,
            newState: 'CANCELLED',
            details: {
              orderRef: order.order_ref,
              reason,
              restoredProducts: Array.from(restoreByProduct.entries()).map(([productId, quanta]) => ({
                productId,
                restoredQuanta: quanta,
              })),
            },
          },
        });
      }

      await this.outboxService.enqueue(
        {
          aggregateType: 'Order',
          aggregateId: order.id,
          eventType: 'OrderCancelledEvent',
          routingKey: 'orders.lifecycle.cancelled',
          payload: {
            orderId: order.id,
            orderRef: order.order_ref,
            sellerBusinessId: order.seller_business_id,
            previousStatus: order.status,
            reason,
          },
        },
        tx,
      );

      return {
        orderId: order.id,
        orderRef: order.order_ref,
        previousStatus: order.status,
        status: 'CANCELLED' as const,
        stockRestoredCount: restoreByProduct.size,
        reason,
        cancelledAtEat: new Date().toISOString(),
      };
    });
  }

  async getOrderDetails(
    orderId: string,
    user: AuthenticatedUser,
    tenantContext?: TenantContext,
  ) {
    const order = await this.prismaService.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        cashLedger: {
          select: {
            id: true,
            verificationStatus: true,
            isBuyerConfirmed: true,
            isDriverConfirmed: true,
            isQrTokenConsumed: true,
            expectedCashAmount: true,
            collectedCashAmount: true,
            paymentMethod: true,
            reconciledAt: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderId} was not found.`);
    }

    const isAuthorized =
      user.role === Role.SUPER_ADMIN ||
      order.buyerUserId === user.sub ||
      order.driverUserId === user.sub ||
      (tenantContext?.businessId && order.sellerBusinessId === tenantContext.businessId);

    if (!isAuthorized) {
      throw new ForbiddenException('Cross-tenant order inspection denied.');
    }

    return {
      orderId: order.id,
      orderRef: order.orderRef,
      buyerUserId: order.buyerUserId,
      sellerBusinessId: order.sellerBusinessId,
      driverUserId: order.driverUserId,
      status: order.status,
      originChannel: order.originChannel,
      routingTargetPipeline: order.routingTargetPipeline,
      expectedTotalTzs: Number(order.expectedTotalTzs),
      deliveryFeeTzs: Number(order.deliveryFeeTzs),
      paymentMethod: order.paymentMethod,
      paidAmountTzs: Number(order.paidAmountTzs),
      placedAt: order.placedAt.toISOString(),
      dispatchedAt: order.dispatchedAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        unitType: item.unitType,
        quantity: item.quantity,
        baseUnitsTotal: item.baseUnitsTotal,
        unitPriceTzs: Number(item.unitPriceTzs),
        lineTotalTzs: Number(item.lineTotalTzs),
        isWholesaleTierApplied: item.isWholesaleTierApplied,
      })),
      cashLedger: order.cashLedger
        ? {
            id: order.cashLedger.id,
            verificationStatus: order.cashLedger.verificationStatus,
            isBuyerConfirmed: order.cashLedger.isBuyerConfirmed,
            isDriverConfirmed: order.cashLedger.isDriverConfirmed,
            isQrTokenConsumed: order.cashLedger.isQrTokenConsumed,
            expectedCashAmount: Number(order.cashLedger.expectedCashAmount),
            collectedCashAmount: Number(order.cashLedger.collectedCashAmount),
            paymentMethod: order.cashLedger.paymentMethod,
            reconciledAt: order.cashLedger.reconciledAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  async listMyOrders(
    user: AuthenticatedUser,
    tenantContext?: TenantContext,
    scope: 'buying' | 'selling' | 'all' = 'all',
  ) {
    let where: Prisma.OrderWhereInput;

    if (scope === 'buying') {
      where = { buyerUserId: user.sub };
    } else if (scope === 'selling') {
      if (user.role === Role.SUPER_ADMIN) {
        where = {};
      } else if (tenantContext?.businessId) {
        where = { sellerBusinessId: tenantContext.businessId };
      } else {
        throw new ForbiddenException(
          'Authenticated Merchant tenant context is required for selling order queue.',
        );
      }
    } else if (user.role === Role.SUPER_ADMIN) {
      where = {};
    } else if (user.role === Role.DRIVER) {
      where = { driverUserId: user.sub };
    } else if (tenantContext?.businessId) {
      where = {
        OR: [
          { buyerUserId: user.sub },
          { sellerBusinessId: tenantContext.businessId },
        ],
      };
    } else {
      where = { buyerUserId: user.sub };
    }

    const orders = await this.prismaService.order.findMany({
      where,
      orderBy: { placedAt: 'desc' },
      take: 100,
      include: {
        seller: {
          select: {
            id: true,
            businessName: true,
            tier: true,
            smsShortCode: true,
            isPlatformManaged: true,
          },
        },
        buyer: {
          select: {
            id: true,
            fullName: true,
            phoneE164: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                smsItemCode: true,
                nameSw: true,
                nameEn: true,
              },
            },
          },
        },
        cashLedger: {
          select: {
            verificationStatus: true,
            isBuyerConfirmed: true,
            isDriverConfirmed: true,
            isQrTokenConsumed: true,
            expectedCashAmount: true,
            collectedCashAmount: true,
            paymentMethod: true,
            reconciledAt: true,
          },
        },
      },
    });

    return {
      count: orders.length,
      orders: orders.map((order) => ({
        orderId: order.id,
        orderRef: order.orderRef,
        buyerUserId: order.buyerUserId,
        buyerName: order.buyer.fullName,
        buyerPhoneE164: order.buyer.phoneE164,
        sellerBusinessId: order.sellerBusinessId,
        sellerBusinessName: order.seller.businessName,
        sellerTier: order.seller.tier,
        sellerShortCode: order.seller.smsShortCode,
        driverUserId: order.driverUserId,
        status: order.status,
        originChannel: order.originChannel,
        routingTargetPipeline: order.routingTargetPipeline,
        expectedTotalTzs: Number(order.expectedTotalTzs),
        deliveryFeeTzs: Number(order.deliveryFeeTzs),
        paymentMethod: order.paymentMethod,
        paidAmountTzs: Number(order.paidAmountTzs),
        placedAt: order.placedAt.toISOString(),
        dispatchedAt: order.dispatchedAt?.toISOString() ?? null,
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
        items: order.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          smsItemCode: item.product.smsItemCode,
          nameSw: item.product.nameSw,
          nameEn: item.product.nameEn,
          unitType: item.unitType,
          quantity: item.quantity,
          baseUnitsTotal: item.baseUnitsTotal,
          unitPriceTzs: Number(item.unitPriceTzs),
          lineTotalTzs: Number(item.lineTotalTzs),
          isWholesaleTierApplied: item.isWholesaleTierApplied,
        })),
        cashLedger: order.cashLedger
          ? {
              verificationStatus: order.cashLedger.verificationStatus,
              isBuyerConfirmed: order.cashLedger.isBuyerConfirmed,
              isDriverConfirmed: order.cashLedger.isDriverConfirmed,
              isQrTokenConsumed: order.cashLedger.isQrTokenConsumed,
              expectedCashAmount: Number(order.cashLedger.expectedCashAmount),
              collectedCashAmount: Number(order.cashLedger.collectedCashAmount),
              paymentMethod: order.cashLedger.paymentMethod,
              reconciledAt: order.cashLedger.reconciledAt?.toISOString() ?? null,
            }
          : null,
      })),
    };
  }

  private async tryAcquireRedisLock(
    key: string,
    token: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    try {
      const client = this.redisService.getClient() as unknown as {
        status?: string;
        set?: (...args: Array<string | number>) => Promise<string | null>;
      };
      if (!client || typeof client.set !== 'function') {
        return true;
      }
      if (client.status && client.status !== 'ready') {
        return true;
      }
      const res = await client.set(key, token, 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch {
      return true;
    }
  }

  private async releaseRedisLock(key: string, token: string): Promise<void> {
    try {
      const client = this.redisService.getClient() as unknown as {
        status?: string;
        eval?: (script: string, numkeys: number, ...args: string[]) => Promise<unknown>;
      };
      if (!client || typeof client.eval !== 'function') {
        return;
      }
      if (client.status && client.status !== 'ready') {
        return;
      }
      await client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        token,
      );
    } catch {
      // Lock naturally expires by TTL
    }
  }
}
