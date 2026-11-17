import './test-env.setup';
import { ConflictException, ForbiddenException, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@redis/redis.service';
import { sanitizeCsvCell, UTF8_BOM } from '@modules/10-financials/csv-formula.util';
import { FinancialsService } from '@modules/10-financials/financials.service';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

describe('Phase 3D: EOD Driver Settlement, Partial Payments, Mobile Money Verification, Analytics & Swahili CSV', () => {
  const wholesalerUserId = '11111111-1111-4111-8111-111111111111';
  const wholesalerBusinessId = '22222222-2222-4222-8222-222222222222';
  const otherBusinessId = '33333333-3333-4333-8333-333333333333';
  const driverId = '44444444-4444-4444-8444-444444444444';

  const wholesalerUser: AuthenticatedUser = {
    sub: wholesalerUserId,
    role: Role.WHOLESALER,
    businessId: wholesalerBusinessId,
    merchantId: wholesalerBusinessId,
    tier: 'WHOLESALE_HUB',
  };

  const wholesalerTenant: TenantContext = {
    businessId: wholesalerBusinessId,
    merchantId: wholesalerBusinessId,
    tier: 'WHOLESALE_HUB',
    isPlatformManaged: true,
    geospatialMapEnabled: false,
    isSuperAdmin: false,
  };

  it('blocks cross-tenant access and businessId spoofing at service and HTTP TenantContextGuard layers (Scenario 11)', async () => {
    const prisma = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      posSaleReceipt: { findMany: jest.fn().mockResolvedValue([]) },
      cashDeliveryLedger: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const outbox = { enqueue: jest.fn() } as unknown as OutboxService;
    const service = new FinancialsService(prisma, outbox);

    await expect(
      service.getDailyRevenueAnalytics(otherBusinessId, wholesalerTenant),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.generateSwahiliAnalyticsCsv(wholesalerTenant, otherBusinessId),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.listDriversForEod(wholesalerTenant, otherBusinessId),
    ).rejects.toThrow(ForbiddenException);

    // HTTP verification through full AppModule + JwtAuthGuard + TenantContextGuard
    const mockPrismaHttp = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      businessProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: wholesalerBusinessId,
          tier: 'WHOLESALE_HUB',
          isPlatformManaged: true,
          geospatialMapEnabled: false,
        }),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            orderRef: 'SK100001',
            placedAt: new Date('2026-11-17T10:00:00.000Z'),
            status: 'DELIVERED',
            paymentMethod: 'CASH',
            expectedTotalTzs: 25000n,
            paidAmountTzs: 25000n,
            items: [{ isWholesaleTierApplied: true, lineTotalTzs: 25000n }],
            buyer: { fullName: '=CMD|"calc"!A0' },
            cashLedger: {
              collectedCashAmount: 25000n,
              paymentMethod: 'CASH',
              verificationStatus: 'SUCCESSFUL',
            },
          },
        ]),
      },
      posSaleReceipt: { findMany: jest.fn().mockResolvedValue([]) },
      cashDeliveryLedger: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaHttp)
      .overrideProvider(RedisService)
      .useValue({
        ping: jest.fn().mockResolvedValue({ connected: true, pingResponse: 'PONG' }),
        getClient: jest.fn(),
        onModuleDestroy: jest.fn().mockResolvedValue(undefined),
      })
      .compile();

    const app: INestApplication = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    try {
      const jwtService = app.get(JwtService);
      const token = await jwtService.signAsync(
        {
          sub: wholesalerUserId,
          role: Role.WHOLESALER,
          businessId: wholesalerBusinessId,
        },
        { secret: process.env.JWT_ACCESS_SECRET },
      );

      // Cross-tenant param/query spoofing must be blocked with 403
      await request(app.getHttpServer())
        .get(`/api/v1/hybrid/analytics/${otherBusinessId}/daily-revenue`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/hybrid/analytics/export-csv?businessId=${otherBusinessId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await request(app.getHttpServer())
        .get(`/api/v1/wholesale/eod/drivers?businessId=${otherBusinessId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      // Own-tenant analytics & Swahili CSV export succeed with UTF-8 BOM + escaped formula payload
      const analyticsRes = await request(app.getHttpServer())
        .get(`/api/v1/hybrid/analytics/${wholesalerBusinessId}/daily-revenue`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(analyticsRes.body).toMatchObject({
        sellerBusinessId: wholesalerBusinessId,
        b2bWholesaleRevenueTzs: 25000,
        totalCollectedTzs: 25000,
      });

      const csvRes = await request(app.getHttpServer())
        .get('/api/v1/hybrid/analytics/export-csv')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(csvRes.headers['content-type']).toContain('text/csv; charset=utf-8');
      expect(csvRes.text.startsWith(UTF8_BOM)).toBe(true);
      expect(csvRes.text).toContain('Kumbukumbu');
      expect(csvRes.text).toContain('"\'=CMD|""calc""!A0"');
    } finally {
      await app.close();
    }
  });

  it('tracks partial payments, blocks unacknowledged EOD balance, and preserves outstanding balance on acknowledged settle (Scenario 12)', async () => {
    const ledgerState = {
      ledger_id: 'led-1',
      order_id: 'ord-1',
      order_ref: 'SKPART01',
      order_status: 'DELIVERED',
      origin_channel: 'APP_CART',
      seller_business_id: wholesalerBusinessId,
      driver_user_id: driverId,
      expected_cash_amount: 50000n,
      collected_cash_amount: 0n,
      payment_method: 'CASH',
      mobile_money_ref: null as string | null,
      mobile_money_verified: false,
      verification_status: 'SUCCESSFUL',
      eod_settled_at: null as Date | null,
    };

    const auditLogs: any[] = [];
    const outboxEvents: any[] = [];
    const createdBatches: any[] = [];

    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('FROM pos_sales_receipts')) return [];
        if (sql.includes('FROM cash_delivery_ledgers')) {
          return ledgerState.eod_settled_at ? [] : [{ ...ledgerState, id: ledgerState.ledger_id }];
        }
        return [];
      }),
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        const sql = strings.join(' ');
        if (sql.includes('SET collected_cash_amount')) {
          ledgerState.collected_cash_amount = BigInt(values[0]);
          ledgerState.payment_method = values[1];
          ledgerState.mobile_money_ref = values[2];
          ledgerState.mobile_money_verified = Boolean(values[3]);
        } else if (sql.includes('SET eod_settled_at = NOW()')) {
          ledgerState.eod_settled_at = new Date();
        }
        return 1;
      }),
      eodSettlementBatch: {
        create: jest.fn(async ({ data }: any) => {
          const batch = { id: 'batch-partial-1', createdAt: new Date(), ...data };
          createdBatches.push(batch);
          return batch;
        }),
      },
      financialAuditLog: {
        create: jest.fn(async ({ data }: any) => {
          auditLogs.push(data);
          return data;
        }),
      },
    };

    const prisma = {
      runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
    } as unknown as PrismaService;
    const outbox = {
      enqueue: jest.fn(async (ev: any) => {
        outboxEvents.push(ev);
        return { id: 'out-1' };
      }),
    } as unknown as OutboxService;

    const service = new FinancialsService(prisma, outbox);

    // Record partial payment (30,000 collected out of 50,000 expected -> 20,000 outstanding)
    const partialRes = await service.recordPartialOrFullPayment(
      'ord-1',
      { collectedAmountTzs: 30000, paymentMethod: 'CASH' },
      wholesalerUser,
      wholesalerTenant,
    );
    expect(partialRes).toEqual({
      orderId: 'ord-1',
      expectedAmountTzs: 50000,
      collectedAmountTzs: 30000,
      outstandingBalanceTzs: 20000,
      paymentMethod: 'CASH',
      mobileMoneyVerified: true,
      isPartialPayment: true,
    });

    // Unacknowledged partial balance must fail EOD settlement (409)
    await expect(
      service.settleDriverEod(
        driverId,
        { declaredCashTzs: 30000, acknowledgeOutstandingBalance: false },
        wholesalerUser,
        wholesalerTenant,
      ),
    ).rejects.toThrow(ConflictException);

    // Explicit acknowledgement settles EOD while preserving exact outstandingBalanceTzs
    const settled = await service.settleDriverEod(
      driverId,
      {
        declaredCashTzs: 30000,
        acknowledgeOutstandingBalance: true,
        notes: 'Salio litakusanywa kesho',
      },
      wholesalerUser,
      wholesalerTenant,
    );

    expect(settled).toMatchObject({
      batchId: 'batch-partial-1',
      expectedTotalTzs: 50000,
      collectedTotalTzs: 30000,
      outstandingBalanceTzs: 20000,
      varianceTzs: 0,
    });
    expect(createdBatches[0].outstandingBalanceTzs).toBe(20000n);
    expect(auditLogs.map((a) => a.eventType)).toEqual([
      'PARTIAL_PAYMENT_RECORDED',
      'EOD_DRIVER_SETTLED',
    ]);
    expect(outboxEvents[0].eventType).toBe('EodReconciliationSettledEvent');
  });

  it('rejects delivered-without-confirmation, open DISPUTED ledgers, and unverified M-PESA, then settles after verification (Scenario 13 & 14)', async () => {
    const ledger = {
      ledger_id: 'led-mm-1',
      order_id: 'ord-mm-1',
      order_ref: 'SKMM0001',
      order_status: 'DELIVERED',
      origin_channel: 'APP_CART',
      seller_business_id: wholesalerBusinessId,
      driver_user_id: driverId,
      expected_cash_amount: 45000n,
      collected_cash_amount: 45000n,
      payment_method: 'M-PESA',
      mobile_money_ref: 'MP881122' as string | null,
      mobile_money_verified: false,
      verification_status: 'WAITING',
      eod_settled_at: null as Date | null,
    };

    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('FROM pos_sales_receipts')) return [];
        if (sql.includes('FROM cash_delivery_ledgers')) {
          return ledger.eod_settled_at ? [] : [{ ...ledger, id: ledger.ledger_id }];
        }
        return [];
      }),
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
        const sql = strings.join(' ');
        if (sql.includes('SET mobile_money_ref')) {
          ledger.mobile_money_ref = values[0];
          ledger.mobile_money_verified = Boolean(values[1]);
        } else if (sql.includes('SET eod_settled_at = NOW()')) {
          ledger.eod_settled_at = new Date();
        }
        return 1;
      }),
      eodSettlementBatch: {
        create: jest.fn(async () => ({ id: 'batch-mm-1', createdAt: new Date() })),
      },
      financialAuditLog: { create: jest.fn().mockResolvedValue({ id: 'fin-mm' }) },
    };

    const prisma = {
      runInTransaction: jest.fn(async (_iso: any, fn: (c: any) => Promise<any>) => fn(tx)),
    } as unknown as PrismaService;
    const outbox = {
      enqueue: jest.fn().mockResolvedValue({ id: 'out-mm' }),
    } as unknown as OutboxService;

    const service = new FinancialsService(prisma, outbox);

    // 1. Order status DELIVERED but verification_status WAITING -> blocked
    await expect(
      service.settleDriverEod(driverId, { declaredCashTzs: 0 }, wholesalerUser, wholesalerTenant),
    ).rejects.toThrow(/EOD_BLOCKED_UNRESOLVED_EXCEPTIONS/);

    // 2. Open DISPUTED ledger -> blocked
    ledger.verification_status = 'DISPUTED';
    await expect(
      service.settleDriverEod(driverId, { declaredCashTzs: 0 }, wholesalerUser, wholesalerTenant),
    ).rejects.toThrow(/EOD_BLOCKED_UNRESOLVED_EXCEPTIONS/);

    // 3. Verification status SUCCESSFUL but M-PESA not verified -> blocked
    ledger.verification_status = 'SUCCESSFUL';
    await expect(
      service.settleDriverEod(driverId, { declaredCashTzs: 0 }, wholesalerUser, wholesalerTenant),
    ).rejects.toThrow(/EOD_BLOCKED_UNVERIFIED_MOBILE_MONEY/);

    // 4. Verify mobile money -> settlement succeeds
    await service.verifyMobileMoneyLedger(
      'ord-mm-1',
      { mobileMoneyRef: 'MP881122', verified: true },
      wholesalerUser,
      wholesalerTenant,
    );
    const settled = await service.settleDriverEod(
      driverId,
      { declaredCashTzs: 0 },
      wholesalerUser,
      wholesalerTenant,
    );
    expect(settled).toMatchObject({
      batchId: 'batch-mm-1',
      collectedTotalTzs: 45000,
      breakdown: {
        cashTotalTzs: 0,
        mpesaTotalTzs: 45000,
      },
    });

    // 5. Duplicate / concurrent second EOD settlement call sees empty unlocked queue -> 409 Conflict (Scenario 14)
    await expect(
      service.settleDriverEod(driverId, { declaredCashTzs: 0 }, wholesalerUser, wholesalerTenant),
    ).rejects.toThrow(/EOD_ALREADY_SETTLED_OR_EMPTY/);
  });

  it('exports UTF-8 BOM Swahili headers and neutralizes every CWE-1236 spreadsheet formula prefix (Scenario 15)', async () => {
    expect(sanitizeCsvCell('=CMD()')).toBe('"\'=CMD()"');
    expect(sanitizeCsvCell('+255712345678')).toBe('"\'+255712345678"');
    expect(sanitizeCsvCell('-5000')).toBe('"\'-5000"');
    expect(sanitizeCsvCell('@SUM(A1:A5)')).toBe('"\'@SUM(A1:A5)"');
    expect(sanitizeCsvCell('\tHYPERLINK("evil")')).toBe('"\'\tHYPERLINK(""evil"")"');

    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            orderRef: 'SK990011',
            placedAt: new Date('2026-11-17T08:00:00.000Z'),
            status: 'DELIVERED',
            paymentMethod: 'M-PESA',
            expectedTotalTzs: 18000n,
            paidAmountTzs: 18000n,
            buyer: { fullName: '@IMPORTXML("http://bad")' },
            cashLedger: {
              collectedCashAmount: 18000n,
              paymentMethod: 'M-PESA',
              verificationStatus: 'SUCCESSFUL',
            },
          },
        ]),
      },
      posSaleReceipt: {
        findMany: jest.fn().mockResolvedValue([
          {
            receiptId: 'POS-001',
            createdAt: new Date('2026-11-17T09:00:00.000Z'),
            paymentMethod: 'CASH',
            totalTzs: 5000n,
            collectedAmountTzs: 5000n,
            paymentVerified: true,
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new FinancialsService(prisma, { enqueue: jest.fn() } as unknown as OutboxService);
    const csv = await service.generateSwahiliAnalyticsCsv(wholesalerTenant);

    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain('"Kumbukumbu","Tarehe (EAT)","Aina ya Mauzo"');
    expect(csv).toContain('"ODA YA SOKOKUU"');
    expect(csv).toContain('"MAUZO YA DUKA (POS)"');
    expect(csv).toContain('"\'@IMPORTXML(""http://bad"")"');
  });
});
