import './test-env.setup';
import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { SelfRegistrableRole } from '@modules/01-identity/dto/auth.dto';
import { IdentityService } from '@modules/01-identity/identity.service';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@redis/redis.service';

describe('Phase 2: IdentityService (Argon2id, Refresh Rotation & Brute-Force Protection)', () => {
  const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const configService = new ConfigService({
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    JWT_ACCESS_EXPIRES_IN: '15m',
  });

  let redisStore: Map<string, string>;
  let usersStore: Map<string, any>;
  let sessionsStore: Map<string, any>;
  let auditLogs: any[];
  let outboxEvents: any[];

  let service: IdentityService;

  beforeEach(() => {
    redisStore = new Map();
    usersStore = new Map();
    sessionsStore = new Map();
    auditLogs = [];
    outboxEvents = [];

    const mockRedisClient = {
      get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
      incr: jest.fn(async (key: string) => {
        const next = Number.parseInt(redisStore.get(key) ?? '0', 10) + 1;
        redisStore.set(key, String(next));
        return next;
      }),
      expire: jest.fn(async () => 1),
      del: jest.fn(async (...keys: string[]) => {
        keys.forEach((k) => redisStore.delete(k));
        return keys.length;
      }),
    };

    const mockRedisService = {
      getClient: () => mockRedisClient,
    } as unknown as RedisService;

    const txClient = {
      user: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: '11111111-1111-1111-1111-111111111111',
            ...data,
            isActive: true,
            createdAt: new Date(),
          };
          usersStore.set(row.phoneE164, row);
          return row;
        }),
      },
      refreshSession: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: data.id ?? `sess-${sessionsStore.size + 1}`,
            revokedAt: null,
            replacedBy: null,
            ...data,
          };
          sessionsStore.set(row.tokenHash, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          for (const s of sessionsStore.values()) {
            if (s.id === where.id) {
              Object.assign(s, data);
              return s;
            }
          }
          return null;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const s of sessionsStore.values()) {
            if (
              (!where.familyId || s.familyId === where.familyId) &&
              (!where.userId || s.userId === where.userId) &&
              s.revokedAt === null
            ) {
              Object.assign(s, data);
              count += 1;
            }
          }
          return { count };
        }),
      },
      securityAuditLog: {
        create: jest.fn(async ({ data }: any) => {
          auditLogs.push(data);
          return data;
        }),
      },
    };

    const mockPrismaService = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.phoneE164) {
            const u = usersStore.get(where.phoneE164);
            return u ? { ...u, ownedMerchants: [{ id: 'merchant-1', tier: 'RETAIL_DUKA' }] } : null;
          }
          return null;
        }),
      },
      refreshSession: {
        findUnique: jest.fn(async ({ where }: any) => {
          const s = sessionsStore.get(where.tokenHash);
          if (!s) return null;
          const user = [...usersStore.values()].find((u) => u.id === s.userId);
          return {
            ...s,
            user: {
              ...user,
              ownedMerchants: [{ id: 'merchant-1', tier: 'RETAIL_DUKA' }],
            },
          };
        }),
        update: txClient.refreshSession.update,
        updateMany: txClient.refreshSession.updateMany,
      },
      securityAuditLog: txClient.securityAuditLog,
      runInTransaction: jest.fn(async (_iso: any, fn: (tx: any) => Promise<any>) => fn(txClient)),
    } as unknown as PrismaService;

    const mockOutboxService = {
      enqueue: jest.fn(async (input: any) => {
        outboxEvents.push(input);
        return { id: `outbox-${outboxEvents.length}` };
      }),
    } as unknown as OutboxService;

    service = new IdentityService(
      mockPrismaService,
      mockRedisService,
      mockOutboxService,
      jwtService,
      configService,
    );
  });

  it('registers with Argon2id password hash, 64-char sms_hmac_secret, and emits outbox event', async () => {
    const res = await service.register(
      {
        phoneE164: '+255712345678',
        fullName: 'Amina Hassan',
        password: 'StrongPassword#2026',
        role: SelfRegistrableRole.RETAILER,
      },
      '127.0.0.1',
    );

    expect(res.tokenType).toBe('Bearer');
    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();

    const storedUser = usersStore.get('+255712345678');
    expect(storedUser.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(storedUser.passwordHash, 'StrongPassword#2026')).toBe(true);
    expect(storedUser.smsHmacSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0].eventType).toBe('UserRegisteredEvent');
  });

  it('locks out account after 5 failed login attempts via Redis throttling', async () => {
    await service.register(
      {
        phoneE164: '+255712345679',
        fullName: 'Juma Ally',
        password: 'CorrectPassword#1',
        role: SelfRegistrableRole.WHOLESALER,
      },
      '10.0.0.5',
    );

    for (let i = 0; i < 5; i += 1) {
      await expect(
        service.login({ phoneE164: '+255712345679', password: 'WrongPassword' }, '10.0.0.5'),
      ).rejects.toThrow(UnauthorizedException);
    }

    await expect(
      service.login({ phoneE164: '+255712345679', password: 'CorrectPassword#1' }, '10.0.0.5'),
    ).rejects.toThrow(HttpException);

    try {
      await service.login(
        { phoneE164: '+255712345679', password: 'CorrectPassword#1' },
        '10.0.0.5',
      );
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
    expect(auditLogs.some((l) => l.eventType === 'LOGIN_BRUTE_FORCE_LOCKOUT')).toBe(true);
  });

  it('rotates refresh token and revokes entire session family on token replay', async () => {
    const initial = await service.register({
      phoneE164: '+255712345680',
      fullName: 'Neema Mushi',
      password: 'Password!234',
      role: SelfRegistrableRole.RETAILER,
    });

    const rotated = await service.refresh({ refreshToken: initial.refreshToken }, '127.0.0.1');
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    expect(rotated.accessToken).toBeTruthy();

    // Replay the previously rotated initial refresh token -> triggers family-wide revocation
    await expect(
      service.refresh({ refreshToken: initial.refreshToken }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);

    // Subsequent attempt with rotated token must also fail because the entire family was revoked
    await expect(
      service.refresh({ refreshToken: rotated.refreshToken }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);

    expect(auditLogs.some((l) => l.eventType === 'REFRESH_TOKEN_REUSE_DETECTED')).toBe(true);
    expect(outboxEvents.some((e) => e.eventType === 'RefreshTokenReuseDetectedEvent')).toBe(true);
  });
});
