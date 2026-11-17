import './test-env.setup';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { PricingRoutingEngine } from '@modules/07-pricing/pricing-routing.engine';
import { OutboundSmsService } from '@modules/13-notifications/outbound-sms.service';
import {
  computeCompactSmsSig6,
  normalizeTanzanianPhoneE164,
  parseCompactSmsCommand,
} from '@modules/14-webhooks/compact-sms.parser';
import { NextSmsWebhookService } from '@modules/14-webhooks/nextsms-webhook.service';

describe('Phase 3C: NextSMS Inbound Webhook, SIG6 HMAC, Replay Idempotency, Doorstep Cancel & Outbound Retries', () => {
  const userHmacSecret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const sellerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const productId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const userId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const driverId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  it('normalizes Tanzanian MSISDNs and parses compact ORDER and CANCEL grammars', () => {
    expect(normalizeTanzanianPhoneE164('0712345678')).toBe('+255712345678');
    expect(normalizeTanzanianPhoneE164('255654987321')).toBe('+255654987321');
    expect(normalizeTanzanianPhoneE164('+255755111222')).toBe('+255755111222');

    const sig = computeCompactSmsSig6(userHmacSecret, 'SK#AB12CD34#KH1#SUG1:K:2');
    const parsedOrder = parseCompactSmsCommand(`SK#AB12CD34#KH1#SUG1:K:2#${sig}`);
    expect(parsedOrder.action).toBe('ORDER');
    if (parsedOrder.action === 'ORDER') {
      expect(parsedOrder.items[0]).toEqual({
        smsItemCode: 'SUG1',
        unitType: 'SINGLE_KILO_LITRE',
        quantity: 2,
      });
    }

    const cancelSig = computeCompactSmsSig6(userHmacSecret, 'SK#CANCEL#AB12CD34');
    const parsedCancel = parseCompactSmsCommand(`SK#CANCEL#AB12CD34#${cancelSig}`);
    expect(parsedCancel.action).toBe('CANCEL');
  });

  it('rejects tampered SIG6 HMAC with 401 and deduplicates repeated NextSMS callbacks', async () => {
    const inboundLogs: any[] = [];
    const securityLogs: any[] = [];
    const smsLogs: any[] = [];
    let looseStock = 40;

    const tx = {
      businessProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: sellerId,
          businessName: 'Kariakoo Hub 1',
          tier: 'HYBRID_STORE',
          isOpen: true,
          isPlatformManaged: true,
        }),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: productId,
            sellerBusinessId: sellerId,
            smsItemCode: 'SUG1',
            nameSw: 'Sukari',
            nameEn: 'Sugar',
            cartonPriceTzs: 60000n,
            dozenPriceTzs: 30000n,
            packPriceTzs: 12000n,
            unitPriceTzs: 3000n,
            sealedParentUnitType: 'SACK_50KG',
            quantaPerSealedPackage: 200,
            wholesaleMinUnitsThreshold: 10,
            wholesaleMinWeightKg: 5,
            wholesaleMinQuarterQuanta: 20,
            priceTiers: [],
          },
        ]),
      },
      $queryRaw: jest.fn(async () => [
        { base_quarter_quanta_stock: looseStock, sealed_bulk_packages_stock: 0 },
      ]),
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        if (strings.join(' ').includes('UPDATE products')) {
          looseStock = Number(values[0]);
        }
        return 1;
      }),
      order: {
        create: jest.fn(async ({ data }: any) => ({
          id: data.id,
          orderRef: data.orderRef,
        })),
      },
      orderItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      orderDispatchAuditTrace: { create: jest.fn().mockResolvedValue({ id: 'tr-1' }) },
      nextSmsInboundLog: {
        create: jest.fn(async ({ data }: any) => {
          inboundLogs.push(data);
          return data;
        }),
      },
      financialAuditLog: { create: jest.fn().mockResolvedValue({ id: 'fin-1' }) },
      smsDeliveryLog: {
        create: jest.fn(async ({ data }: any) => {
          smsLogs.push(data);
          return { id: `sms-${smsLogs.length}`, status: 'QUEUED' };
        }),
      },
    };

    const prisma = {
      nextSmsInboundLog: {
        findUnique: jest.fn(async ({ where }: any) =>
          inboundLogs.find((l) => l.messageId && l.messageId === where.messageId) ?? null,
        ),
        findFirst: jest.fn(async ({ where }: any) =>
          inboundLogs.find(
            (l) =>
              l.orderRef8 === where.orderRef8 &&
              l.parsedAction === where.parsedAction &&
              l.status === 'PROCESSED',
          ) ?? null,
        ),
        create: tx.nextSmsInboundLog.create,
      },
      securityAuditLog: {
        create: jest.fn(async ({ data }: any) => {
          securityLogs.push(data);
          return data;
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: userId,
          fullName: 'Juma Ally',
          role: 'RETAILER',
          smsHmacSecret: userHmacSecret,
          isActive: true,
        }),
      },
      runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
    } as unknown as PrismaService;

    const outbox = {
      enqueue: jest.fn().mockResolvedValue({ id: 'out-1' }),
    } as unknown as OutboxService;
    const pricingEngine = new PricingRoutingEngine(prisma);
    const configService = new ConfigService({ NEXTSMS_SENDER_ID: 'SOKOKUU' });
    const outboundSms = new OutboundSmsService(prisma, configService);
    const webhookService = new NextSmsWebhookService(prisma, outbox, pricingEngine, outboundSms);

    // 1. Tampered SIG6 -> 401 Unauthorized + audit logs recorded
    await expect(
      webhookService.handleInboundSms(
        {
          from: '0712345678',
          text: 'SK#AB12CD34#KH1#SUG1:K:2#DEAD00',
          messageId: 'msg-bad-1',
        },
        '41.59.10.2',
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(securityLogs).toHaveLength(1);
    expect(inboundLogs.find((l) => l.messageId === 'msg-bad-1')?.status).toBe('REJECTED');

    // 2. Valid SIG6 -> creates NEXTSMS_INBOUND order & deducts 8 quanta (40 -> 32)
    const validSig = computeCompactSmsSig6(userHmacSecret, 'SK#AB12CD34#KH1#SUG1:K:2');
    const created = await webhookService.handleInboundSms(
      {
        from: '0712345678',
        text: `SK#AB12CD34#KH1#SUG1:K:2#${validSig}`,
        messageId: 'msg-good-1',
      },
      '41.59.10.2',
    );
    expect(created).toMatchObject({
      status: 'PROCESSED',
      idempotentReplay: false,
      action: 'ORDER',
      orderRef8: 'AB12CD34',
      expectedTotalTzs: 6000,
    });
    expect(looseStock).toBe(32);
    expect(smsLogs).toHaveLength(1);

    // 3. Duplicate callback replay -> safely ignored without deducting stock again
    const replay = await webhookService.handleInboundSms({
      from: '0712345678',
      text: `SK#AB12CD34#KH1#SUG1:K:2#${validSig}`,
      messageId: 'msg-good-1',
    });
    expect(replay).toMatchObject({
      status: 'DUPLICATE_IGNORED',
      idempotentReplay: true,
    });
    expect(looseStock).toBe(32);
  });

  it('processes SK#CANCEL#REF8#SIG6 atomically for assigned driver, restores stock, marks DISPUTED, and blocks DELIVERED', async () => {
    let orderStatus: 'DISPATCHED' | 'DELIVERED' | 'CANCELLED' = 'DISPATCHED';
    let stockRestored = 0;
    const outboxEvents: any[] = [];

    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        if (strings.join(' ').includes('FROM orders')) {
          return [
            {
              id: 'ord-cancel-1',
              order_ref: 'XY998877',
              buyer_user_id: userId,
              seller_business_id: sellerId,
              driver_user_id: driverId,
              status: orderStatus,
              expected_total_tzs: 12000n,
            },
          ];
        }
        return [{ id: productId }];
      }),
      businessProfile: {
        findUnique: jest.fn().mockResolvedValue({ ownerUserId: 'owner-other' }),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([{ productId, baseUnitsTotal: 12 }]),
      },
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        const sql = strings.join(' ');
        if (sql.includes('UPDATE products')) {
          stockRestored += Number(values[0]);
        } else if (sql.includes("status = 'CANCELLED'")) {
          orderStatus = 'CANCELLED';
        }
        return 1;
      }),
      nextSmsInboundLog: { create: jest.fn().mockResolvedValue({ id: 'inb-c1' }) },
      financialAuditLog: { create: jest.fn().mockResolvedValue({ id: 'fin-c1' }) },
    };

    const prisma = {
      nextSmsInboundLog: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      securityAuditLog: { create: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: driverId,
          fullName: 'Dereva Musa',
          role: 'DRIVER',
          smsHmacSecret: userHmacSecret,
          isActive: true,
        }),
      },
      runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
    } as unknown as PrismaService;

    const outbox = {
      enqueue: jest.fn(async (ev: any) => {
        outboxEvents.push(ev);
        return { id: 'out-disp-1' };
      }),
    } as unknown as OutboxService;

    const webhookService = new NextSmsWebhookService(
      prisma,
      outbox,
      new PricingRoutingEngine(prisma),
      new OutboundSmsService(prisma, new ConfigService()),
    );

    const cancelSig = computeCompactSmsSig6(userHmacSecret, 'SK#CANCEL#XY998877');

    // DELIVERED order cannot be cancelled via SMS -> 409 Conflict
    orderStatus = 'DELIVERED';
    await expect(
      webhookService.handleInboundSms({
        from: '255712000999',
        text: `SK#CANCEL#XY998877#${cancelSig}`,
      }),
    ).rejects.toThrow(ConflictException);

    // DISPATCHED order cancelled by assigned driver -> stock restored + DeliveryDisputeEvent emitted
    orderStatus = 'DISPATCHED';
    const res = await webhookService.handleInboundSms({
      from: '255712000999',
      text: `SK#CANCEL#XY998877#${cancelSig}`,
    });
    expect(res).toMatchObject({
      status: 'PROCESSED',
      action: 'CANCEL',
      orderStatus: 'CANCELLED',
      ledgerVerificationStatus: 'DISPUTED',
    });
    expect(stockRestored).toBe(12);
    expect(outboxEvents[0].eventType).toBe('DeliveryDisputeEvent');

    // Unauthorized sender -> 403 Forbidden
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'stranger-user',
      role: 'CONSUMER',
      smsHmacSecret: userHmacSecret,
      isActive: true,
    });
    await expect(
      webhookService.handleInboundSms({
        from: '+255712000111',
        text: `SK#CANCEL#XY998877#${cancelSig}`,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('tracks outbound NextSMS retry backoff and transitions to DEAD_LETTER after maxAttempts', async () => {
    let attempts = 0;
    let smsStatus = 'QUEUED';
    let outboxStatus = 'PENDING';

    const prisma = {
      smsDeliveryLog: {
        findUnique: jest.fn(async () => ({
          id: 'sms-dl-1',
          outboxEventId: 'out-dl-1',
          recipientPhoneE164: '+255712345678',
          messageBody: 'SokoKuu: Mtihani wa SMS',
          status: smsStatus,
          attemptCount: attempts,
          maxAttempts: 2,
        })),
        update: jest.fn(async ({ data }: any) => {
          attempts = data.attemptCount;
          smsStatus = data.status;
          return data;
        }),
      },
      domainOutboxEvent: {
        update: jest.fn(async ({ data }: any) => {
          outboxStatus = data.status;
          return data;
        }),
      },
    } as unknown as PrismaService;

    const smsService = new OutboundSmsService(prisma, new ConfigService());

    // Attempt 1 fails (missing credentials / transport outage) -> FAILED with nextRetryAt
    const first = await smsService.dispatchSmsLog('sms-dl-1');
    expect(first.status).toBe('FAILED');
    expect(first.nextRetryAt).toBeTruthy();
    expect(outboxStatus).toBe('FAILED');

    // Attempt 2 fails -> reaches maxAttempts=2 -> DEAD_LETTER
    const second = await smsService.dispatchSmsLog('sms-dl-1');
    expect(second.status).toBe('DEAD_LETTER');
    expect(second.nextRetryAt).toBeNull();
    expect(outboxStatus).toBe('DEAD_LETTER');
  });
});
