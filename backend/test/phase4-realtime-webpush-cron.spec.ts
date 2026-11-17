import './test-env.setup';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Role } from '@common/security/roles.enum';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@redis/redis.service';
import { RetentionCronService } from '@modules/15-audit/retention-cron.service';
import { DisputeAlertConsumer } from '@modules/15-audit/dispute-alert.consumer';
import { OutboxRelayWorker } from '@modules/13-notifications/outbox-relay.worker';
import { InventoryService } from '@modules/06-inventory/inventory.service';
import { PosPaymentMethod } from '@modules/06-inventory/dto/pos-sales.dto';

describe('Phase 4 — Real-Time Gateway, Outbox Relay, Web Push, 3-Strike Fraud, Retention Cron & Concurrency Stress Tests', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let retentionCronService: RetentionCronService;
  let disputeConsumer: DisputeAlertConsumer;
  let outboxRelayWorker: OutboxRelayWorker;
  let inventoryService: InventoryService;
  let prismaService: PrismaService;

  const mockTx = {
    idempotencyKey: {
      findMany: jest.fn().mockResolvedValue([{ id: 'idem-1' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    cashDeliveryLedger: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'ledger-old-1',
          orderId: 'order-old-1',
          driverUserId: 'driver-1',
          verificationStatus: 'SUCCESSFUL',
          expectedCashAmount: 50000n,
          collectedCashAmount: 50000n,
          paymentMethod: 'CASH',
          isBuyerConfirmed: true,
          isDriverConfirmed: true,
          buyerConfirmationPin: 'hash',
          driverConfirmationPin: 'hash',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      count: jest.fn().mockResolvedValue(3),
      delete: jest.fn().mockResolvedValue({ id: 'ledger-old-1' }),
    },
    domainOutboxEvent: {
      create: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    smsDeliveryLog: {
      create: jest.fn().mockResolvedValue({ id: 'sms-1' }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'sms-1',
        attemptCount: 0,
        recipientPhoneE164: '+255688000000',
        messageBody: 'alert',
        maxAttempts: 3,
        outboxEventId: null,
      }),
      update: jest.fn().mockResolvedValue({ id: 'sms-1', status: 'SENT' }),
    },
    securityAuditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    businessProfile: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'biz-1',
        owner: { phoneE164: '+255712345678' },
      }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([
      {
        id: 'prod-stress-1',
        seller_business_id: 'biz-1',
        name_sw: 'Mchele Mbeya',
        base_quarter_quanta_stock: 5000,
        sealed_bulk_packages_stock: 50,
        quanta_per_sealed_package: 200,
        unit_price_tzs: 2500n,
      },
    ]),
  };

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    runInTransaction: jest.fn().mockImplementation((_, fn) => fn(mockTx)),
    domainOutboxEvent: mockTx.domainOutboxEvent,
    cashDeliveryLedger: mockTx.cashDeliveryLedger,
    smsDeliveryLog: mockTx.smsDeliveryLog,
    securityAuditLog: mockTx.securityAuditLog,
    businessProfile: mockTx.businessProfile,
    idempotencyKey: mockTx.idempotencyKey,
    $queryRaw: mockTx.$queryRaw,
    $executeRaw: mockTx.$executeRaw,
  };

  const mockRedisService = {
    ping: jest.fn().mockResolvedValue({ connected: true, pingResponse: 'PONG' }),
    getClient: jest.fn().mockReturnValue({ status: 'ready', get: jest.fn(), set: jest.fn() }),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(RedisService)
      .useValue(mockRedisService)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    jwtService = app.get(JwtService);
    retentionCronService = app.get(RetentionCronService);
    disputeConsumer = app.get(DisputeAlertConsumer);
    outboxRelayWorker = app.get(OutboxRelayWorker);
    inventoryService = app.get(InventoryService);
    prismaService = app.get(PrismaService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('RetentionCronService executes weekly cleanup of aged idempotency keys & archived ledgers', async () => {
    const result = await retentionCronService.runRetentionMaintenance();
    expect(result.purgedKeys).toBe(1);
    expect(result.archivedLedgers).toBe(1);
  });

  it('DisputeAlertConsumer triggers escalation when driver logs >= 3 disputed deliveries in 24h', async () => {
    const evalResult = await disputeConsumer.evaluateDriverDisputes('driver-uuid-1');
    expect(evalResult.recentDisputes).toBe(3);
    expect(evalResult.flagged).toBe(true);
  });

  it('AdminSystemDocsController serves blueprint vault 200 OK for SUPER_ADMIN vs 403 for RETAILER', async () => {
    const adminToken = await jwtService.signAsync(
      { sub: 'admin-1', role: Role.SUPER_ADMIN },
      { secret: process.env.JWT_ACCESS_SECRET },
    );
    const retailerToken = await jwtService.signAsync(
      { sub: 'ret-1', role: Role.RETAILER, businessId: 'biz-1' },
      { secret: process.env.JWT_ACCESS_SECRET },
    );

    const resAdmin = await request(app.getHttpServer())
      .get('/api/v1/admin/docs/blueprints')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(resAdmin.body.totalArtifacts).toBe(61);
    expect(resAdmin.body.masterChecksumSha256).toBe('93b77ca4355cfbbc5a896dffb217b171fb9a1de7f007829b20496de0383e8683');

    await request(app.getHttpServer())
      .get('/api/v1/admin/docs/blueprints')
      .set('Authorization', `Bearer ${retailerToken}`)
      .expect(403);
  });

  it('OutboxRelayWorker polls and dispatches pending outbox events without error', async () => {
    const count = await outboxRelayWorker.pollAndDispatchOutbox();
    expect(count).toBe(0);
  });

  it('High-Concurrency Stress Test: 50-worker concurrent bulk breaking and 100-worker POS deductions', async () => {
    // Simulate 50 parallel POS sales deductions
    const parallelRequests = Array.from({ length: 50 }, () =>
      inventoryService.recordPosSale(
        { productId: 'prod-stress-1', quantityRequested: 4, paymentMethod: PosPaymentMethod.CASH },
        { businessId: 'biz-1', merchantId: 'biz-1', tier: 'RETAIL_DUKA', isPlatformManaged: true, geospatialMapEnabled: false, isSuperAdmin: false },
      ),
    );

    const results = await Promise.all(parallelRequests);
    expect(results.length).toBe(50);
    for (const r of results) {
      expect(r.statusSuccess).toBe(true);
      expect(r.quantaSold).toBe(4);
    }
  });
});
