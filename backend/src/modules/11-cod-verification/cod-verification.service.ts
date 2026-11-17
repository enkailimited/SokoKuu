import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerVerificationStatus, OrderStatus, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { timingSafeEqual } from 'crypto';
import { AuthenticatedUser } from '@common/security/auth.types';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { computeWeightedAvgPurchaseCost } from '@modules/05-catalog/costing.util';
import { assertValidOrderTransition } from '@modules/09-orders/order-state.policy';
import { RedisService } from '@redis/redis.service';
import {
  BuyerConfirmPinDto,
  DriverConfirmPinDto,
  IsolatedBuyerPinDto,
  IsolatedDriverPinDto,
  RetailerQrScanDto,
  VerifyDoorstepQrDto,
} from './dto/cod-verification.dto';
import { verifyQrSignatureConstantTime } from './qr-crypto.util';

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_WINDOW_SECONDS = 900;

interface LockedCodOrderRow {
  id: string;
  order_ref: string;
  buyer_user_id: string;
  seller_business_id: string;
  driver_user_id: string | null;
  status: OrderStatus;
  expected_total_tzs: bigint;
}

interface LockedCodLedgerRow {
  id: string;
  order_id: string;
  driver_user_id: string | null;
  one_time_qr_token: string | null;
  qr_token_expires_at: Date | null;
  qr_token_signature: string | null;
  is_qr_token_consumed: boolean;
  buyer_confirmation_pin: string;
  driver_confirmation_pin: string;
  is_buyer_confirmed: boolean;
  is_driver_confirmed: boolean;
  expected_cash_amount: bigint;
  collected_cash_amount: bigint;
  payment_method: string;
  mobile_money_ref: string | null;
  mobile_money_verified: boolean;
  verification_status: LedgerVerificationStatus;
}

@Injectable()
export class CodVerificationService {
  private readonly fallbackAttempts = new Map<string, number>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async confirmBuyerPin(
    orderId: string,
    dto: BuyerConfirmPinDto,
    user: AuthenticatedUser,
    ipAddress?: string,
  ) {
    await this.assertNotPinLocked(orderId, 'BUYER');

    try {
      return await this.prismaService.runInTransaction('Serializable', async (tx) => {
        const { order, ledger } = await this.lockOrderAndLedger(tx, orderId);

        if (user.role !== Role.SUPER_ADMIN && order.buyer_user_id !== user.sub) {
          throw new ForbiddenException('Only the assigned buyer can submit Buyer confirmation PIN.');
        }

        if (ledger.is_qr_token_consumed || ledger.verification_status === 'SUCCESSFUL') {
          throw new ConflictException('ERROR_QR_CODE_ALREADY_CONSUMED');
        }

        if (dto.qrToken) {
          this.validateQrTokenOnLedger(order.id, ledger, dto.qrToken);
        }

        const pinValid = await argon2.verify(ledger.buyer_confirmation_pin, dto.buyerPin);
        if (!pinValid) {
          throw new UnauthorizedException('INVALID_BUYER_PIN');
        }

        await this.resetPinAttempts(orderId, 'BUYER');

        const nextStatus: LedgerVerificationStatus = ledger.is_driver_confirmed
          ? 'SUCCESSFUL'
          : 'BUYER_CONFIRMED';

        await tx.$executeRaw`
          UPDATE cash_delivery_ledgers
             SET is_buyer_confirmed = TRUE,
                 buyer_confirmed_at = NOW(),
                 verification_status = ${nextStatus}::ledger_verification_status,
                 version = version + 1,
                 updated_at = NOW()
           WHERE id = ${ledger.id}::uuid
        `;

        if (ledger.is_driver_confirmed) {
          this.validateQrTokenOnLedger(order.id, ledger, dto.qrToken ?? ledger.one_time_qr_token ?? '');
          const reconciled = await this.finalizeConsensusDelivery(tx, order, ledger, user.sub, {
            collectedCashAmount: ledger.expected_cash_amount,
            paymentMethod: ledger.payment_method,
            mobileMoneyRef: ledger.mobile_money_ref,
            mobileMoneyVerified: ledger.mobile_money_verified,
          });
          return reconciled;
        }

        return {
          orderId: order.id,
          orderRef: order.order_ref,
          isBuyerConfirmed: true,
          isDriverConfirmed: false,
          verificationStatus: 'BUYER_CONFIRMED' as const,
          reconciled: false,
        };
      });
    } catch (error) {
      if (error instanceof UnauthorizedException && error.message === 'INVALID_BUYER_PIN') {
        await this.recordFailedPinAttempt(orderId, 'BUYER', user.sub, ipAddress);
      }
      throw error;
    }
  }

  async confirmDriverPin(
    orderId: string,
    dto: DriverConfirmPinDto,
    user: AuthenticatedUser,
    ipAddress?: string,
  ) {
    await this.assertNotPinLocked(orderId, 'DRIVER');

    try {
      return await this.prismaService.runInTransaction('Serializable', async (tx) => {
        const { order, ledger } = await this.lockOrderAndLedger(tx, orderId);

        if (user.role !== Role.SUPER_ADMIN && order.driver_user_id !== user.sub) {
          throw new ForbiddenException('Only the assigned driver can submit Driver confirmation PIN.');
        }

        if (ledger.is_qr_token_consumed || ledger.verification_status === 'SUCCESSFUL') {
          throw new ConflictException('ERROR_QR_CODE_ALREADY_CONSUMED');
        }

        const pinValid = await argon2.verify(ledger.driver_confirmation_pin, dto.driverPin);
        if (!pinValid) {
          throw new UnauthorizedException('INVALID_DRIVER_PIN');
        }

        await this.resetPinAttempts(orderId, 'DRIVER');

        const expectedCash = BigInt(ledger.expected_cash_amount);
        const collectedCash = BigInt(dto.collectedCashTzs);
        if (collectedCash !== expectedCash) {
          throw new ConflictException(
            `CASH_AMOUNT_MISMATCH: Expected ${expectedCash.toString()} TZS, collected ${collectedCash.toString()} TZS.`,
          );
        }

        const paymentMethod = dto.paymentMethod ?? ledger.payment_method ?? 'CASH';
        const mobileMoneyVerified =
          paymentMethod === 'CASH' ? true : Boolean(dto.mobileMoneyVerified);

        const nextStatus: LedgerVerificationStatus = ledger.is_buyer_confirmed
          ? 'SUCCESSFUL'
          : 'DRIVER_CONFIRMED';

        await tx.$executeRaw`
          UPDATE cash_delivery_ledgers
             SET is_driver_confirmed = TRUE,
                 driver_confirmed_at = NOW(),
                 collected_cash_amount = ${collectedCash},
                 payment_method = ${paymentMethod},
                 mobile_money_ref = ${dto.mobileMoneyRef ?? null},
                 mobile_money_verified = ${mobileMoneyVerified},
                 verification_status = ${nextStatus}::ledger_verification_status,
                 version = version + 1,
                 updated_at = NOW()
           WHERE id = ${ledger.id}::uuid
        `;

        if (ledger.is_buyer_confirmed) {
          this.validateQrTokenOnLedger(order.id, ledger, ledger.one_time_qr_token ?? '');
          return this.finalizeConsensusDelivery(tx, order, ledger, user.sub, {
            collectedCashAmount: collectedCash,
            paymentMethod,
            mobileMoneyRef: dto.mobileMoneyRef ?? null,
            mobileMoneyVerified,
          });
        }

        return {
          orderId: order.id,
          orderRef: order.order_ref,
          isBuyerConfirmed: false,
          isDriverConfirmed: true,
          collectedCashAmountTzs: Number(collectedCash),
          verificationStatus: 'DRIVER_CONFIRMED' as const,
          reconciled: false,
        };
      });
    } catch (error) {
      if (error instanceof UnauthorizedException && error.message === 'INVALID_DRIVER_PIN') {
        await this.recordFailedPinAttempt(orderId, 'DRIVER', user.sub, ipAddress);
      }
      throw error;
    }
  }

  async verifyDoorstepQr(
    dto: VerifyDoorstepQrDto,
    user: AuthenticatedUser,
    ipAddress?: string,
  ) {
    await this.assertNotPinLocked(dto.orderId, 'BUYER');
    await this.assertNotPinLocked(dto.orderId, 'DRIVER');

    try {
      return await this.prismaService.runInTransaction('Serializable', async (tx) => {
        const { order, ledger } = await this.lockOrderAndLedger(tx, dto.orderId);

        const isAuthorized =
          user.role === Role.SUPER_ADMIN ||
          order.buyer_user_id === user.sub ||
          order.driver_user_id === user.sub;
        if (!isAuthorized) {
          throw new ForbiddenException('Not authorized to reconcile doorstep QR for this order.');
        }

        if (ledger.is_qr_token_consumed || ledger.verification_status === 'SUCCESSFUL') {
          throw new ConflictException('ERROR_QR_CODE_ALREADY_CONSUMED');
        }

        this.validateQrTokenOnLedger(order.id, ledger, dto.qrToken, dto.qrSignature);

        const buyerValid = await argon2.verify(ledger.buyer_confirmation_pin, dto.buyerPin);
        if (!buyerValid) {
          throw new UnauthorizedException('INVALID_BUYER_PIN');
        }

        const driverValid = await argon2.verify(ledger.driver_confirmation_pin, dto.driverPin);
        if (!driverValid) {
          throw new UnauthorizedException('INVALID_DRIVER_PIN');
        }

        await this.resetPinAttempts(dto.orderId, 'BUYER');
        await this.resetPinAttempts(dto.orderId, 'DRIVER');

        const expectedCash = BigInt(ledger.expected_cash_amount);
        const collectedCash = BigInt(dto.collectedCashTzs);
        if (collectedCash !== expectedCash) {
          throw new ConflictException(
            `CASH_AMOUNT_MISMATCH: Expected ${expectedCash.toString()} TZS, collected ${collectedCash.toString()} TZS.`,
          );
        }

        await tx.$executeRaw`
          UPDATE cash_delivery_ledgers
             SET is_buyer_confirmed = TRUE,
                 is_driver_confirmed = TRUE,
                 buyer_confirmed_at = COALESCE(buyer_confirmed_at, NOW()),
                 driver_confirmed_at = COALESCE(driver_confirmed_at, NOW())
           WHERE id = ${ledger.id}::uuid
        `;

        return this.finalizeConsensusDelivery(tx, order, ledger, user.sub, {
          collectedCashAmount: collectedCash,
          paymentMethod: ledger.payment_method ?? 'CASH',
          mobileMoneyRef: ledger.mobile_money_ref,
          mobileMoneyVerified: ledger.payment_method === 'CASH' ? true : ledger.mobile_money_verified,
        });
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        if (error.message === 'INVALID_BUYER_PIN') {
          await this.recordFailedPinAttempt(dto.orderId, 'BUYER', user.sub, ipAddress);
        } else if (error.message === 'INVALID_DRIVER_PIN') {
          await this.recordFailedPinAttempt(dto.orderId, 'DRIVER', user.sub, ipAddress);
        }
      }
      throw error;
    }
  }

  async retailerQrScan(dto: RetailerQrScanDto, user: AuthenticatedUser) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const { order, ledger } = await this.lockOrderAndLedger(tx, dto.orderId);

      if (user.role !== Role.SUPER_ADMIN && order.buyer_user_id !== user.sub) {
        throw new ForbiddenException('Only the order buyer can scan the doorstep QR code.');
      }

      if (ledger.is_qr_token_consumed || ledger.verification_status === 'SUCCESSFUL') {
        throw new ConflictException('ERROR_QR_CODE_ALREADY_CONSUMED');
      }

      this.validateQrTokenOnLedger(order.id, ledger, dto.qrToken, dto.qrSignature);

      await this.outboxService.enqueue(
        {
          aggregateType: 'Order',
          aggregateId: order.id,
          eventType: 'DriverPinModalTriggerEvent',
          routingKey: 'realtime.driver.pin_modal_open',
          payload: {
            signal: 'TRIGGER_DRIVER_PIN_MODAL_OPEN',
            orderId: order.id,
            orderRef: order.order_ref,
            driverUserId: order.driver_user_id,
            buyerUserId: order.buyer_user_id,
            expectedCashAmountTzs: Number(ledger.expected_cash_amount),
          },
        },
        tx,
      );

      return {
        orderId: order.id,
        orderRef: order.order_ref,
        qrVerified: true,
        driverPinModalTriggered: true,
        driverUserId: order.driver_user_id,
        expectedCashAmountTzs: Number(ledger.expected_cash_amount),
      };
    });
  }

  async isolatedBuyerPin(
    dto: IsolatedBuyerPinDto,
    user: AuthenticatedUser,
    ipAddress?: string,
  ) {
    return this.confirmBuyerPin(dto.orderId, { buyerPin: dto.buyerPin }, user, ipAddress);
  }

  async isolatedDriverPin(
    dto: IsolatedDriverPinDto,
    user: AuthenticatedUser,
    ipAddress?: string,
  ) {
    return this.confirmDriverPin(
      dto.orderId,
      {
        driverPin: dto.driverPin,
        collectedCashTzs: dto.collectedCashTzs,
        paymentMethod: dto.paymentMethod,
        mobileMoneyRef: dto.mobileMoneyRef,
        mobileMoneyVerified: dto.mobileMoneyVerified,
      },
      user,
      ipAddress,
    );
  }

  private async lockOrderAndLedger(tx: Prisma.TransactionClient, orderId: string) {
    const orders = await tx.$queryRaw<LockedCodOrderRow[]>`
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

    const order = orders[0];
    if (!order) {
      throw new NotFoundException(`Order ${orderId} was not found.`);
    }

    const ledgers = await tx.$queryRaw<LockedCodLedgerRow[]>`
      SELECT id::text AS id,
             order_id::text AS order_id,
             driver_user_id::text AS driver_user_id,
             one_time_qr_token,
             qr_token_expires_at,
             qr_token_signature,
             is_qr_token_consumed,
             buyer_confirmation_pin,
             driver_confirmation_pin,
             is_buyer_confirmed,
             is_driver_confirmed,
             expected_cash_amount,
             collected_cash_amount,
             payment_method,
             mobile_money_ref,
             mobile_money_verified,
             verification_status
        FROM cash_delivery_ledgers
       WHERE order_id = ${orderId}::uuid
         FOR UPDATE
    `;

    const ledger = ledgers[0];
    if (!ledger) {
      throw new NotFoundException(`Cash delivery ledger for order ${orderId} was not found.`);
    }

    return { order, ledger };
  }

  private validateQrTokenOnLedger(
    orderId: string,
    ledger: LockedCodLedgerRow,
    providedQrToken: string,
    providedSignature?: string,
  ): void {
    if (ledger.is_qr_token_consumed) {
      throw new ConflictException('ERROR_QR_CODE_ALREADY_CONSUMED');
    }

    if (!ledger.one_time_qr_token || !providedQrToken) {
      throw new ConflictException('ERROR_QR_TOKEN_NOT_ISSUED');
    }

    const expectedTokenBuf = Buffer.from(ledger.one_time_qr_token);
    const providedTokenBuf = Buffer.from(providedQrToken.trim());
    if (
      expectedTokenBuf.length !== providedTokenBuf.length ||
      !timingSafeEqual(expectedTokenBuf, providedTokenBuf)
    ) {
      throw new UnauthorizedException('ERROR_QR_TOKEN_MISMATCH');
    }

    if (!ledger.qr_token_expires_at || ledger.qr_token_expires_at.getTime() < Date.now()) {
      throw new GoneException('ERROR_QR_TOKEN_EXPIRED');
    }

    if (ledger.qr_token_signature) {
      const secret =
        this.configService.get<string>('QR_TOKEN_HMAC_SECRET') ??
        this.configService.get<string>('JWT_ACCESS_SECRET')!;
      const sigToVerify = providedSignature?.trim() || ledger.qr_token_signature;
      const validSig = verifyQrSignatureConstantTime(
        secret,
        orderId,
        ledger.one_time_qr_token,
        ledger.qr_token_expires_at.toISOString(),
        sigToVerify,
      );
      if (!validSig) {
        throw new UnauthorizedException('ERROR_QR_SIGNATURE_INVALID');
      }
    }
  }

  private async finalizeConsensusDelivery(
    tx: Prisma.TransactionClient,
    order: LockedCodOrderRow,
    ledger: LockedCodLedgerRow,
    actorUserId: string,
    settlement: {
      collectedCashAmount: bigint;
      paymentMethod: string;
      mobileMoneyRef: string | null;
      mobileMoneyVerified: boolean;
    },
  ) {
    assertValidOrderTransition(order.status, 'DELIVERED');

    await tx.$executeRaw`
      UPDATE cash_delivery_ledgers
         SET is_qr_token_consumed = TRUE,
             collected_cash_amount = ${settlement.collectedCashAmount},
             payment_method = ${settlement.paymentMethod},
             mobile_money_ref = ${settlement.mobileMoneyRef},
             mobile_money_verified = ${settlement.mobileMoneyVerified},
             verification_status = 'SUCCESSFUL'::ledger_verification_status,
             reconciled_at = NOW(),
             version = version + 1,
             updated_at = NOW()
       WHERE id = ${ledger.id}::uuid
    `;

    await tx.$executeRaw`
      UPDATE orders
         SET status = 'DELIVERED'::order_status,
             delivered_at = NOW(),
             payment_method = ${settlement.paymentMethod},
             paid_amount_tzs = ${settlement.collectedCashAmount},
             version = version + 1
       WHERE id = ${order.id}::uuid
    `;

    // Hydrate buyer Merchant inventory shelf cleanly when buyer owns a Merchant profile
    let hydratedSkuCount = 0;
    const buyerMerchant = await tx.businessProfile.findFirst({
      where: { ownerUserId: order.buyer_user_id },
      select: { id: true },
    });

    if (buyerMerchant) {
      const orderItems = await tx.orderItem.findMany({
        where: { orderId: order.id },
        include: {
          product: {
            select: {
              globalCatalogId: true,
            },
          },
        },
      });

      const totalOrderQuanta = orderItems.reduce(
        (sum, it) => sum + Math.max(0, Number(it.baseUnitsTotal ?? 0)),
        0,
      );

      for (const item of orderItems) {
        if (!item.product?.globalCatalogId || item.baseUnitsTotal <= 0) {
          continue;
        }

        const itemLineTotalTzs =
          item.lineTotalTzs !== undefined && item.lineTotalTzs !== null
            ? BigInt(item.lineTotalTzs)
            : totalOrderQuanta > 0
              ? (BigInt(settlement.collectedCashAmount) * BigInt(item.baseUnitsTotal)) /
                BigInt(totalOrderQuanta)
              : BigInt(settlement.collectedCashAmount);

        let existingQuanta = 0;
        let existingAvgCost = 0n;
        if (
          tx.merchantClonedProduct &&
          typeof tx.merchantClonedProduct.findUnique === 'function'
        ) {
          const existingClone = await tx.merchantClonedProduct.findUnique({
            where: {
              retailerBusinessId_globalCatalogId: {
                retailerBusinessId: buyerMerchant.id,
                globalCatalogId: item.product.globalCatalogId,
              },
            },
            select: {
              availableQuantaStock: true,
              weightedAvgBuyingCostPerQuantumTzs: true,
            },
          });
          if (existingClone) {
            existingQuanta = Number(existingClone.availableQuantaStock ?? 0);
            existingAvgCost = BigInt(existingClone.weightedAvgBuyingCostPerQuantumTzs ?? 0n);
          }
        }

        const costing = computeWeightedAvgPurchaseCost({
          existingStockQuanta: existingQuanta,
          existingWeightedAvgCostPerQuantumTzs: existingAvgCost,
          receivedQuanta: item.baseUnitsTotal,
          agreedTotalCostTzs: itemLineTotalTzs,
        });

        await tx.$executeRaw`
          INSERT INTO merchant_cloned_products (
            retailer_business_id,
            global_catalog_id,
            available_quanta_stock,
            unit_price_tzs,
            inventory_value_tzs,
            last_buying_price_per_quantum_tzs,
            weighted_avg_buying_cost_per_quantum_tzs,
            buying_price_established
          ) VALUES (
            ${buyerMerchant.id}::uuid,
            ${item.product.globalCatalogId}::uuid,
            ${item.baseUnitsTotal}::integer,
            0,
            ${costing.newInventoryValueTzs},
            ${costing.lastBuyingPricePerQuantumTzs},
            ${costing.weightedAvgBuyingCostPerQuantumTzs},
            TRUE
          )
          ON CONFLICT (retailer_business_id, global_catalog_id)
          DO UPDATE SET
            available_quanta_stock = merchant_cloned_products.available_quanta_stock + ${item.baseUnitsTotal}::integer,
            inventory_value_tzs = ${costing.newInventoryValueTzs},
            last_buying_price_per_quantum_tzs = ${costing.lastBuyingPricePerQuantumTzs},
            weighted_avg_buying_cost_per_quantum_tzs = ${costing.weightedAvgBuyingCostPerQuantumTzs},
            buying_price_established = TRUE,
            updated_at = NOW()
        `;
        hydratedSkuCount += 1;
      }
    }

    if (tx.financialAuditLog && typeof tx.financialAuditLog.create === 'function') {
      await tx.financialAuditLog.create({
        data: {
          actorUserId,
          sellerBusinessId: order.seller_business_id,
          orderId: order.id,
          eventType: 'ORDER_COD_DELIVERED_RECONCILED',
          amountTzs: settlement.collectedCashAmount,
          previousState: order.status,
          newState: 'DELIVERED',
          details: {
            orderRef: order.order_ref,
            paymentMethod: settlement.paymentMethod,
            mobileMoneyVerified: settlement.mobileMoneyVerified,
            hydratedSkuCount,
          },
        },
      });
    }

    await this.outboxService.enqueue(
      {
        aggregateType: 'Order',
        aggregateId: order.id,
        eventType: 'OrderDeliveredEvent',
        routingKey: 'orders.cod.delivered',
        payload: {
          orderId: order.id,
          orderRef: order.order_ref,
          sellerBusinessId: order.seller_business_id,
          buyerUserId: order.buyer_user_id,
          driverUserId: order.driver_user_id,
          collectedCashAmountTzs: Number(settlement.collectedCashAmount),
          hydratedSkuCount,
        },
      },
      tx,
    );

    return {
      orderId: order.id,
      orderRef: order.order_ref,
      status: 'DELIVERED' as const,
      verificationStatus: 'SUCCESSFUL' as const,
      isQrTokenConsumed: true,
      collectedCashAmountTzs: Number(settlement.collectedCashAmount),
      hydratedSkuCount,
      reconciledAtEat: new Date().toISOString(),
    };
  }

  private pinKey(orderId: string, side: 'BUYER' | 'DRIVER'): string {
    return `pin:fail:${orderId}:${side}`;
  }

  private async assertNotPinLocked(orderId: string, side: 'BUYER' | 'DRIVER'): Promise<void> {
    const key = this.pinKey(orderId, side);
    let attempts = this.fallbackAttempts.get(key) ?? 0;

    try {
      const client = this.redisService.getClient() as unknown as {
        status?: string;
        get?: (k: string) => Promise<string | null>;
      };
      if (client && typeof client.get === 'function' && (!client.status || client.status === 'ready')) {
        const raw = await client.get(key);
        attempts = raw ? Number(raw) : 0;
      }
    } catch {
      // Fallback to in-process attempt tracking when Redis is unreachable in tests
    }

    if (attempts >= MAX_PIN_ATTEMPTS) {
      throw new HttpException(
        `PIN_VERIFICATION_LOCKED: ${side} PIN locked after ${MAX_PIN_ATTEMPTS} failed attempts.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordFailedPinAttempt(
    orderId: string,
    side: 'BUYER' | 'DRIVER',
    userId: string,
    ipAddress?: string,
  ): Promise<void> {
    const key = this.pinKey(orderId, side);
    let attempts = (this.fallbackAttempts.get(key) ?? 0) + 1;
    this.fallbackAttempts.set(key, attempts);

    try {
      const client = this.redisService.getClient() as unknown as {
        status?: string;
        incr?: (k: string) => Promise<number>;
        expire?: (k: string, sec: number) => Promise<number>;
      };
      if (client && typeof client.incr === 'function' && (!client.status || client.status === 'ready')) {
        attempts = await client.incr(key);
        if (attempts === 1 && typeof client.expire === 'function') {
          await client.expire(key, PIN_LOCK_WINDOW_SECONDS);
        }
      }
    } catch {
      // Retain fallback count
    }

    const isLocked = attempts >= MAX_PIN_ATTEMPTS;
    if (this.prismaService.securityAuditLog && typeof this.prismaService.securityAuditLog.create === 'function') {
      await this.prismaService.securityAuditLog.create({
        data: {
          userId,
          eventType: isLocked ? 'COD_PIN_BRUTE_FORCE_LOCKOUT' : 'COD_PIN_FAILED_ATTEMPT',
          ipAddress: ipAddress ?? null,
          details: {
            orderId,
            side,
            attempts,
            locked: isLocked,
          },
        },
      });
    }
  }

  private async resetPinAttempts(orderId: string, side: 'BUYER' | 'DRIVER'): Promise<void> {
    const key = this.pinKey(orderId, side);
    this.fallbackAttempts.delete(key);

    try {
      const client = this.redisService.getClient() as unknown as {
        status?: string;
        del?: (k: string) => Promise<number>;
      };
      if (client && typeof client.del === 'function' && (!client.status || client.status === 'ready')) {
        await client.del(key);
      }
    } catch {
      // Ignore Redis cleanup failure
    }
  }
}
