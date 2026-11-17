import './test-env.setup';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Role } from '@common/security/roles.enum';
import { setupSwagger } from '@config/swagger.config';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@redis/redis.service';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

describe('App Bootstrap, Swagger OpenAPI & Health/Readiness Integration', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    runInTransaction: jest.fn(),
    checkDatabaseReadiness: jest.fn(),
    businessProfile: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockRedisService = {
    ping: jest.fn(),
    getClient: jest.fn(),
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
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates OpenAPI/Swagger specification with Bearer JWT, NextSMS API key, and Merchant terminology (zero "shop" wording)', () => {
    const document = setupSwagger(app);

    expect(document.openapi).toMatch(/^3\./);
    expect(document.components?.securitySchemes).toHaveProperty('bearer');
    expect(document.components?.securitySchemes).toHaveProperty('nextsms-gateway-token');
    expect(document.paths).toHaveProperty('/api/v1/health');
    expect(document.paths).toHaveProperty('/api/v1/health/readiness');
    expect(document.paths).toHaveProperty('/api/v1/admin/merchants');
    expect(document.paths).toHaveProperty('/api/v1/auth/login');
    expect(document.paths).toHaveProperty('/api/v1/marketplace/catalog/clone-standard');
    expect(document.paths).toHaveProperty('/api/v1/retailer/pos/sales-receipt');
    expect(document.paths).toHaveProperty('/api/v1/pricing/calculate-quote');
    expect(document.paths).toHaveProperty('/api/v1/orders/request');
    expect(document.paths).toHaveProperty('/api/v1/marketplace/orders/submit-request');
    expect(document.paths).toHaveProperty('/api/v1/orders/{orderId}/dispatch');
    expect(document.paths).toHaveProperty('/api/v1/orders/verify-doorstep-qr');
    expect(document.paths).toHaveProperty('/api/v1/callback/nextsms/incoming');
    expect(document.paths).toHaveProperty('/api/v1/wholesale/eod-settle/{driverId}');
    expect(document.paths).toHaveProperty('/api/v1/hybrid/analytics/export-csv');
    expect(document.paths).toHaveProperty('/api/v1/admin/managed-orders');
    expect(document.paths).toHaveProperty('/api/v1/admin/units');
    expect(document.paths).toHaveProperty('/api/v1/admin/marketplace/catalog/{globalCatalogId}/units');
    expect(document.paths).toHaveProperty('/api/v1/admin/marketplace/catalog/{globalCatalogId}/standard-prices');
    expect(document.paths).toHaveProperty('/api/v1/marketplace/catalog/{globalCatalogId}/standard-prices');
    expect(document.paths).toHaveProperty('/api/v1/merchant/catalog/{clonedProductId}/select-or-amend-price');
    expect(document.paths).toHaveProperty('/api/v1/merchant/catalog/{clonedProductId}/reset-price');
    expect(document.paths).toHaveProperty('/api/v1/merchant/purchases/external-receipt');
    expect(document.paths).toHaveProperty('/api/v1/pricing/standard-quote');

    const serializedDoc = JSON.stringify(document);
    expect(serializedDoc.toLowerCase()).not.toContain('"shops"');
    expect(serializedDoc.toLowerCase()).not.toContain('adminshops');
    expect(serializedDoc).toContain('Platform Administration');
    expect(serializedDoc).toContain('Merchants');
  });

  it('GET /api/v1/health returns public liveness OK in Africa/Dar_es_Salaam TZ', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('sokokuu-tz-backend');
    expect(res.body.timezone).toBe('Africa/Dar_es_Salaam');
  });

  it('GET /api/v1/health/readiness returns 200 when PostgreSQL, PostGIS, and Redis are healthy', async () => {
    mockPrismaService.checkDatabaseReadiness.mockResolvedValueOnce({
      connected: true,
      postgisVersion: '3.4 USE_GEOS=1 USE_PROJ=1',
    });
    mockRedisService.ping.mockResolvedValueOnce({
      connected: true,
      pingResponse: 'PONG',
    });

    const res = await request(app.getHttpServer()).get('/api/v1/health/readiness').expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.databaseCluster).toBe('SokoKuu Cloud SQL Database Cluster');
    expect(res.body.checks.postgres.status).toBe('up');
    expect(res.body.checks.postgis.version).toContain('3.4');
    expect(res.body.checks.redis.ping).toBe('PONG');
  });

  it('GET /api/v1/health/readiness returns 503 when Redis or PostgreSQL is degraded', async () => {
    mockPrismaService.checkDatabaseReadiness.mockResolvedValueOnce({
      connected: true,
      postgisVersion: '3.4 USE_GEOS=1 USE_PROJ=1',
    });
    mockRedisService.ping.mockResolvedValueOnce({
      connected: false,
      pingResponse: null,
      error: 'ECONNREFUSED',
    });

    const res = await request(app.getHttpServer()).get('/api/v1/health/readiness').expect(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.redis.status).toBe('down');
  });

  it('enforces JwtAuthGuard, RolesGuard, and ValidationPipe on /api/v1/admin/merchants', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/merchants').expect(401);

    const retailerToken = await jwtService.signAsync(
      {
        sub: '11111111-1111-1111-1111-111111111111',
        role: Role.RETAILER,
        businessId: '22222222-2222-2222-2222-222222222222',
      },
      { secret: process.env.JWT_ACCESS_SECRET },
    );

    await request(app.getHttpServer())
      .get('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${retailerToken}`)
      .expect(403);

    const adminToken = await jwtService.signAsync(
      {
        sub: '99999999-9999-9999-9999-999999999999',
        role: Role.SUPER_ADMIN,
      },
      { secret: process.env.JWT_ACCESS_SECRET },
    );

    // Rejects unknown non-whitelisted DTO fields via global ValidationPipe
    await request(app.getHttpServer())
      .post('/api/v1/admin/merchants/22222222-2222-2222-2222-222222222222/toggle-map')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true, injectedExtraField: 'evil' })
      .expect(400);

    // Valid SUPER_ADMIN request queries Merchant directory cleanly
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/merchants')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual({ count: 0, merchants: [] });
  });
});
