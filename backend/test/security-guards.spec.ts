import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedRequest } from '@common/security/auth.types';
import { JwtAuthGuard } from '@common/security/jwt-auth.guard';
import { NextSmsGatewayTokenGuard } from '@common/security/nextsms-gateway-token.guard';
import { Role } from '@common/security/roles.enum';
import { RolesGuard } from '@common/security/roles.guard';
import { TenantContextGuard } from '@common/security/tenant-context.guard';

function createHttpExecutionContext(req: Partial<AuthenticatedRequest>): ExecutionContext {
  const handler = () => undefined;
  class DummyController {}
  return {
    getHandler: () => handler,
    getClass: () => DummyController,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('Phase 1 Security Guards', () => {
  const jwtAccessSecret = 'a_very_secure_access_secret_with_at_least_32_characters';
  const nextSmsToken = 'nextsms_gateway_secret_token_1234';

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_SECRET') return jwtAccessSecret;
      if (key === 'NEXTSMS_WEBHOOK_SHARED_TOKEN') return nextSmsToken;
      return undefined;
    }),
  } as unknown as ConfigService;

  describe('JwtAuthGuard', () => {
    const jwtService = new JwtService({ secret: jwtAccessSecret });

    it('allows routes decorated with @Public()', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(true),
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(reflector, jwtService, configService);

      const allowed = await guard.canActivate(
        createHttpExecutionContext({ headers: {} }),
      );
      expect(allowed).toBe(true);
    });

    it('rejects requests without a Bearer token', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(reflector, jwtService, configService);

      await expect(
        guard.canActivate(createHttpExecutionContext({ headers: {} })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('authenticates valid JWT and attaches AuthenticatedUser to request', async () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(reflector, jwtService, configService);
      const token = await jwtService.signAsync({
        sub: '11111111-1111-1111-1111-111111111111',
        role: Role.RETAILER,
        merchantId: '22222222-2222-2222-2222-222222222222',
      });
      const req: Partial<AuthenticatedRequest> = {
        headers: { authorization: `Bearer ${token}` },
      };

      const allowed = await guard.canActivate(createHttpExecutionContext(req));
      expect(allowed).toBe(true);
      expect(req.user).toEqual({
        sub: '11111111-1111-1111-1111-111111111111',
        role: Role.RETAILER,
        businessId: '22222222-2222-2222-2222-222222222222',
        merchantId: '22222222-2222-2222-2222-222222222222',
        tier: null,
        phoneE164: undefined,
      });
    });
  });

  describe('RolesGuard', () => {
    it('enforces @Roles() and throws ForbiddenException on mismatch', () => {
      const reflector = {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce([Role.SUPER_ADMIN]),
      } as unknown as Reflector;
      const guard = new RolesGuard(reflector);

      expect(() =>
        guard.canActivate(
          createHttpExecutionContext({
            user: { sub: 'u1', role: Role.RETAILER, merchantId: 'm1' },
          }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('permits matching role', () => {
      const reflector = {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce([Role.SUPER_ADMIN, Role.WHOLESALER]),
      } as unknown as Reflector;
      const guard = new RolesGuard(reflector);

      const allowed = guard.canActivate(
        createHttpExecutionContext({
          user: { sub: 'u1', role: Role.SUPER_ADMIN, merchantId: null },
        }),
      );
      expect(allowed).toBe(true);
    });
  });

  describe('TenantContextGuard', () => {
    it('blocks cross-Merchant tenant spoofing on @TenantScoped() routes', async () => {
      const reflector = {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
      } as unknown as Reflector;
      const guard = new TenantContextGuard(reflector);

      await expect(
        guard.canActivate(
          createHttpExecutionContext({
            user: { sub: 'u1', role: Role.RETAILER, businessId: 'merchant-A' },
            params: { merchantId: 'merchant-B' },
            query: {},
            body: {},
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('derives authoritative tenantContext from business_profiles and permits SUPER_ADMIN administration', async () => {
      const reflector = {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
      } as unknown as Reflector;
      const mockPrisma = {
        businessProfile: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'merchant-db-1',
            tier: 'HYBRID_STORE',
            isPlatformManaged: false,
            geospatialMapEnabled: true,
          }),
        },
      } as any;

      const guard = new TenantContextGuard(reflector, mockPrisma);
      const req: Partial<AuthenticatedRequest> = {
        user: { sub: 'owner-1', role: Role.WHOLESALER, businessId: null },
        params: { merchantId: 'merchant-db-1' },
        query: {},
        body: {},
      };

      await expect(guard.canActivate(createHttpExecutionContext(req))).resolves.toBe(true);
      expect(req.tenantContext).toEqual({
        businessId: 'merchant-db-1',
        merchantId: 'merchant-db-1',
        tier: 'HYBRID_STORE',
        isPlatformManaged: false,
        geospatialMapEnabled: true,
        isSuperAdmin: false,
      });

      const adminReq: Partial<AuthenticatedRequest> = {
        user: { sub: 'admin-1', role: Role.SUPER_ADMIN, businessId: null },
        params: { merchantId: 'merchant-B' },
        query: {},
        body: {},
      };
      const adminGuard = new TenantContextGuard(reflector);
      await expect(adminGuard.canActivate(createHttpExecutionContext(adminReq))).resolves.toBe(true);
      expect(adminReq.tenantContext).toEqual({
        businessId: null,
        merchantId: null,
        tier: null,
        isPlatformManaged: true,
        geospatialMapEnabled: true,
        isSuperAdmin: true,
      });
    });
  });

  describe('NextSmsGatewayTokenGuard', () => {
    const guard = new NextSmsGatewayTokenGuard(configService);

    it('accepts valid X-NextSMS-Gateway-Token using constant-time check', () => {
      const allowed = guard.canActivate(
        createHttpExecutionContext({
          headers: { 'x-nextsms-gateway-token': nextSmsToken },
        }),
      );
      expect(allowed).toBe(true);
    });

    it('rejects invalid or missing X-NextSMS-Gateway-Token', () => {
      expect(() =>
        guard.canActivate(
          createHttpExecutionContext({
            headers: { 'x-nextsms-gateway-token': 'wrong-token' },
          }),
        ),
      ).toThrow(UnauthorizedException);

      expect(() =>
        guard.canActivate(createHttpExecutionContext({ headers: {} })),
      ).toThrow(UnauthorizedException);
    });
  });
});
