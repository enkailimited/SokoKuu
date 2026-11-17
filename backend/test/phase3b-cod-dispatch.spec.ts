import './test-env.setup';
import {
  ConflictException,
  GoneException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { CodVerificationService } from '@modules/11-cod-verification/cod-verification.service';
import { DispatchService } from '@modules/12-dispatch/dispatch.service';
import { RedisService } from '@redis/redis.service';

describe('Phase 3B: Dispatch Dual-PIN Allocation, Signed QR Token, Brute-Force Lockout & Doorstep Closure', () => {
  const orderId = '11111111-1111-1111-1111-111111111111';
  const sellerId = '22222222-2222-2222-2222-222222222222';
  const buyerId = '33333333-3333-3333-3333-333333333333';
  const driverId = '44444444-4444-4444-4444-444444444444';
  const ledgerId = '55555555-5555-5555-5555-555555555555';

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'QR_TOKEN_HMAC_SECRET') return 'test_qr_hmac_secret_with_at_least_32_bytes';
      if (key === 'JWT_ACCESS_SECRET') return 'a_very_secure_access_secret_with_at_least_32_characters';
      if (key === 'QR_TOKEN_TTL_SECONDS') return 300;
      return undefined;
    }),
  } as unknown as ConfigService;

  it('allocates Argon2id Buyer & Driver PINs on dispatch and completes isolated QR + Dual-PIN consensus with replay protection', async () => {
    let orderStatus: 'PLACED' | 'DISPATCHED' | 'DELIVERED' = 'PLACED';
    let buyerPinHash = '';
    let driverPinHash = '';
    let qrToken: string | null = null;
    let qrExpiresAt: Date | null = null;
    let qrSignature: string | null = null;
    let qrConsumed = false;
    let isBuyerConfirmed = false;
    let isDriverConfirmed = false;
    let collectedCash = 0n;
    let verificationStatus: 'WAITING' | 'BUYER_CONFIRMED' | 'DRIVER_CONFIRMED' | 'SUCCESSFUL' =
      'WAITING';
    let hydratedQuanta = 0;

    const outboxEvents: any[] = [];

    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('FROM orders')) {
          return [
            {
              id: orderId,
              order_ref: 'SK778899',
              buyer_user_id: buyerId,
              seller_business_id: sellerId,
              driver_user_id: driverId,
              status: orderStatus,
              expected_total_tzs: 28000n,
              payment_method: 'CASH',
            },
          ];
        }
        if (sql.includes('FROM cash_delivery_ledgers')) {
          return [
            {
              id: ledgerId,
              order_id: orderId,
              driver_user_id: driverId,
              one_time_qr_token: qrToken,
              qr_token_expires_at: qrExpiresAt,
              qr_token_signature: qrSignature,
              is_qr_token_consumed: qrConsumed,
              buyer_confirmation_pin: buyerPinHash,
              driver_confirmation_pin: driverPinHash,
              is_buyer_confirmed: isBuyerConfirmed,
              is_driver_confirmed: isDriverConfirmed,
              expected_cash_amount: 28000n,
              collected_cash_amount: collectedCash,
              payment_method: 'CASH',
              mobile_money_ref: null,
              mobile_money_verified: true,
              verification_status: verificationStatus,
            },
          ];
        }
        return [];
      }),
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        const sql = strings.join(' ');
        if (sql.includes('UPDATE orders') && sql.includes("status = 'DISPATCHED'")) {
          orderStatus = 'DISPATCHED';
        } else if (sql.includes('UPDATE orders') && sql.includes("status = 'DELIVERED'")) {
          orderStatus = 'DELIVERED';
        } else if (sql.includes('SET one_time_qr_token =')) {
          qrToken = values[0];
          qrExpiresAt = values[1];
          qrSignature = values[2];
          qrConsumed = false;
        } else if (sql.includes('SET is_buyer_confirmed = TRUE') && sql.includes('buyer_confirmed_at = NOW()')) {
          isBuyerConfirmed = true;
          verificationStatus = values[0];
        } else if (sql.includes('SET is_driver_confirmed = TRUE') && sql.includes('driver_confirmed_at = NOW()')) {
          isDriverConfirmed = true;
          collectedCash = values[0];
          verificationStatus = values[4];
        } else if (sql.includes('SET is_qr_token_consumed = TRUE')) {
          qrConsumed = true;
          verificationStatus = 'SUCCESSFUL';
          collectedCash = values[0];
        } else if (sql.includes('INSERT INTO merchant_cloned_products')) {
          hydratedQuanta += Number(values[2]);
        }
        return 1;
      }),
      cashDeliveryLedger: {
        upsert: jest.fn(async ({ create }: any) => {
          buyerPinHash = create.buyerConfirmationPin;
          driverPinHash = create.driverConfirmationPin;
          return { id: ledgerId };
        }),
      },
      businessProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: 'retailer-biz-1' }),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([
          { baseUnitsTotal: 24, product: { globalCatalogId: 'global-sku-1' } },
        ]),
      },
      financialAuditLog: { create: jest.fn().mockResolvedValue({ id: 'fin-1' }) },
    };

    const prisma = {
      runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      securityAuditLog: { create: jest.fn().mockResolvedValue({ id: 'sec-1' }) },
    } as unknown as PrismaService;
    const outbox = {
      enqueue: jest.fn(async (ev: any) => {
        outboxEvents.push(ev);
        return { id: `out-${outboxEvents.length}` };
      }),
    } as unknown as OutboxService;

    const redisMap = new Map<string, string>();
    const redis = {
      getClient: jest.fn().mockReturnValue({
        status: 'ready',
        get: jest.fn(async (k: string) => redisMap.get(k) ?? null),
        incr: jest.fn(async (k: string) => {
          const next = Number(redisMap.get(k) ?? '0') + 1;
          redisMap.set(k, String(next));
          return next;
        }),
        expire: jest.fn(async () => 1),
        del: jest.fn(async (k: string) => (redisMap.delete(k) ? 1 : 0)),
      }),
    } as unknown as RedisService;

    const dispatchService = new DispatchService(prisma, outbox, configService);
    const codService = new CodVerificationService(prisma, outbox, redis, configService);

    // 1. Dispatch allocates hashed PINs
    const dispatched = await dispatchService.dispatchOrderAndAllocatePins(
      orderId,
      { driverUserId: driverId },
      { sub: sellerId, role: Role.WHOLESALER },
      {
        businessId: sellerId,
        merchantId: sellerId,
        tier: 'WHOLESALE_HUB',
        isPlatformManaged: true,
        geospatialMapEnabled: false,
        isSuperAdmin: false,
      },
    );

    expect(dispatched.status).toBe('DISPATCHED');
    expect(dispatched.buyerConfirmationPin).toMatch(/^\d{4}$/);
    expect(dispatched.driverConfirmationPin).toMatch(/^\d{4}$/);
    expect(buyerPinHash).toContain('$argon2id$');

    // 2. Driver generates arrival QR
    const arrivalQr = await dispatchService.issueDriverArrivalQr(orderId, {
      sub: driverId,
      role: Role.DRIVER,
    });
    expect(arrivalQr.oneTimeQrToken).toMatch(/^SKQR-[A-F0-9]{12}$/);
    expect(arrivalQr.qrSignature).toHaveLength(64);

    // 3. Buyer scans QR -> triggers Driver PIN modal outbox event
    const scanRes = await codService.retailerQrScan(
      {
        orderId,
        qrToken: arrivalQr.oneTimeQrToken,
        qrSignature: arrivalQr.qrSignature,
      },
      { sub: buyerId, role: Role.RETAILER },
    );
    expect(scanRes.driverPinModalTriggered).toBe(true);
    expect(outboxEvents.some((e) => e.eventType === 'DriverPinModalTriggerEvent')).toBe(true);

    // 4. Buyer submits isolated Buyer PIN
    const buyerAck = await codService.isolatedBuyerPin(
      { orderId, buyerPin: dispatched.buyerConfirmationPin },
      { sub: buyerId, role: Role.RETAILER },
    );
    expect(buyerAck.verificationStatus).toBe('BUYER_CONFIRMED');

    // 5. Driver submits WRONG cash amount -> rejected 409 Conflict
    await expect(
      codService.isolatedDriverPin(
        {
          orderId,
          driverPin: dispatched.driverConfirmationPin,
          collectedCashTzs: 20000,
        },
        { sub: driverId, role: Role.DRIVER },
      ),
    ).rejects.toThrow(ConflictException);

    // 6. Driver submits EXACT cash amount -> completes consensus, consumes QR, hydrates shelf!
    const delivered = await codService.isolatedDriverPin(
      {
        orderId,
        driverPin: dispatched.driverConfirmationPin,
        collectedCashTzs: 28000,
      },
      { sub: driverId, role: Role.DRIVER },
    );
    expect(delivered).toMatchObject({
      status: 'DELIVERED',
      verificationStatus: 'SUCCESSFUL',
      isQrTokenConsumed: true,
    });
    expect(hydratedQuanta).toBe(24);

    // 7. Replayed QR verification -> blocked 409 Conflict (ERROR_QR_CODE_ALREADY_CONSUMED)
    await expect(
      codService.verifyDoorstepQr(
        {
          orderId,
          qrToken: arrivalQr.oneTimeQrToken,
          qrSignature: arrivalQr.qrSignature,
          buyerPin: dispatched.buyerConfirmationPin,
          driverPin: dispatched.driverConfirmationPin,
          collectedCashTzs: 28000,
        },
        { sub: driverId, role: Role.DRIVER },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects expired QR tokens (410 Gone) and enforces Redis PIN brute-force lockout (429)', async () => {
    const validBuyerHash = await argon2.hash('1234', { type: argon2.argon2id });
    const validDriverHash = await argon2.hash('5678', { type: argon2.argon2id });
    const expiredAt = new Date(Date.now() - 60_000);

    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('FROM orders')) {
          return [
            {
              id: orderId,
              order_ref: 'SK112233',
              buyer_user_id: buyerId,
              seller_business_id: sellerId,
              driver_user_id: driverId,
              status: 'DISPATCHED',
              expected_total_tzs: 15000n,
            },
          ];
        }
        return [
          {
            id: ledgerId,
            order_id: orderId,
            driver_user_id: driverId,
            one_time_qr_token: 'SKQR-AABBCCDDEEFF',
            qr_token_expires_at: expiredAt,
            qr_token_signature: null,
            is_qr_token_consumed: false,
            buyer_confirmation_pin: validBuyerHash,
            driver_confirmation_pin: validDriverHash,
            is_buyer_confirmed: false,
            is_driver_confirmed: false,
            expected_cash_amount: 15000n,
            collected_cash_amount: 0n,
            payment_method: 'CASH',
            mobile_money_ref: null,
            mobile_money_verified: true,
            verification_status: 'WAITING',
          },
        ];
      }),
    };

    const securityLogs: any[] = [];
    const prisma = {
      runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
      securityAuditLog: {
        create: jest.fn(async ({ data }: any) => {
          securityLogs.push(data);
          return { id: `sec-${securityLogs.length}` };
        }),
      },
    } as unknown as PrismaService;
    const outbox = { enqueue: jest.fn() } as unknown as OutboxService;

    const redisMap = new Map<string, string>();
    const redis = {
      getClient: jest.fn().mockReturnValue({
        status: 'ready',
        get: jest.fn(async (k: string) => redisMap.get(k) ?? null),
        incr: jest.fn(async (k: string) => {
          const next = Number(redisMap.get(k) ?? '0') + 1;
          redisMap.set(k, String(next));
          return next;
        }),
        expire: jest.fn(async () => 1),
        del: jest.fn(async (k: string) => (redisMap.delete(k) ? 1 : 0)),
      }),
    } as unknown as RedisService;

    const codService = new CodVerificationService(prisma, outbox, redis, configService);

    // Expired QR token -> 410 Gone
    await expect(
      codService.verifyDoorstepQr(
        {
          orderId,
          qrToken: 'SKQR-AABBCCDDEEFF',
          buyerPin: '1234',
          driverPin: '5678',
          collectedCashTzs: 15000,
        },
        { sub: driverId, role: Role.DRIVER },
      ),
    ).rejects.toThrow(GoneException);

    // 5 failed Buyer PIN attempts -> 401 each, 6th -> 429 Locked + SecurityAuditLog
    for (let i = 0; i < 5; i += 1) {
      await expect(
        codService.confirmBuyerPin(
          orderId,
          { buyerPin: '0000' },
          { sub: buyerId, role: Role.RETAILER },
          '197.250.10.2',
        ),
      ).rejects.toThrow(UnauthorizedException);
    }

    expect(securityLogs).toHaveLength(5);
    expect(securityLogs[4].eventType).toBe('COD_PIN_BRUTE_FORCE_LOCKOUT');

    await expect(
      codService.confirmBuyerPin(
        orderId,
        { buyerPin: '1234' },
        { sub: buyerId, role: Role.RETAILER },
        '197.250.10.2',
      ),
    ).rejects.toThrow(HttpException);
  });
});
