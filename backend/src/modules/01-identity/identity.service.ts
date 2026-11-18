import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { MerchantTier, TenantContext } from '@common/security/auth.types';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@redis/redis.service';
import { LoginDto, LogoutDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto';

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_WINDOW_SECONDS = 900; // 15 minutes
const REFRESH_TTL_DAYS = 7;

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: {
    id: string;
    phoneE164: string;
    fullName: string;
    role: Role;
    businessId: string | null;
    tier: MerchantTier | null;
    preferredLocale: string;
  };
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
    private readonly outboxService: OutboxService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto, ipAddress?: string): Promise<AuthTokenResponse> {
    const existing = await this.prismaService.user.findUnique({
      where: { phoneE164: dto.phoneE164 },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A user with this Tanzanian phone number is already registered.');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
    const smsHmacSecret = randomBytes(32).toString('hex'); // 64-char hex secret
    const opaqueRefreshToken = randomBytes(48).toString('base64url');
    const refreshTokenHash = this.hashToken(opaqueRefreshToken);
    const familyId = randomUUID();
    const expiresAt = this.computeRefreshExpiry();

    const user = await this.prismaService.runInTransaction('ReadCommitted', async (tx) => {
      const created = await tx.user.create({
        data: {
          phoneE164: dto.phoneE164,
          fullName: dto.fullName.trim(),
          passwordHash,
          role: dto.role as unknown as Role,
          preferredLocale: dto.preferredLocale ?? 'sw',
          smsHmacSecret,
        },
      });

      await tx.refreshSession.create({
        data: {
          userId: created.id,
          familyId,
          tokenHash: refreshTokenHash,
          expiresAt,
        },
      });

      await tx.securityAuditLog.create({
        data: {
          userId: created.id,
          eventType: 'USER_REGISTERED',
          ipAddress: ipAddress ?? null,
          details: { role: created.role },
        },
      });

      await this.outboxService.enqueue(
        {
          aggregateType: 'User',
          aggregateId: created.id,
          eventType: 'UserRegisteredEvent',
          routingKey: 'identity.user.registered',
          payload: {
            userId: created.id,
            phoneE164: created.phoneE164,
            role: created.role,
          },
        },
        tx,
      );

      return created;
    });

    const accessToken = await this.signAccessToken({
      sub: user.id,
      role: user.role as unknown as Role,
      businessId: null,
      tier: null,
      phoneE164: user.phoneE164,
    });

    return {
      accessToken,
      refreshToken: opaqueRefreshToken,
      tokenType: 'Bearer',
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
      user: {
        id: user.id,
        phoneE164: user.phoneE164,
        fullName: user.fullName,
        role: user.role as unknown as Role,
        businessId: null,
        tier: null,
        preferredLocale: user.preferredLocale,
      },
    };
  }

  async login(dto: LoginDto, ipAddress?: string): Promise<AuthTokenResponse> {
    await this.assertNotBruteForceLocked(dto.phoneE164, ipAddress);

    const user = await this.prismaService.user.findUnique({
      where: { phoneE164: dto.phoneE164 },
      include: {
        ownedMerchants: {
          select: { id: true, tier: true },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user || !user.isActive) {
      await this.recordFailedLoginAttempt(dto.phoneE164, ipAddress, user?.id ?? null);
      throw new UnauthorizedException('Invalid phone number or password.');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      await this.recordFailedLoginAttempt(dto.phoneE164, ipAddress, user.id);
      throw new UnauthorizedException('Invalid phone number or password.');
    }

    await this.clearFailedLoginAttempts(dto.phoneE164, ipAddress);

    const primaryMerchant = user.ownedMerchants[0] ?? null;
    const businessId = primaryMerchant?.id ?? null;
    const tier = (primaryMerchant?.tier as MerchantTier | undefined) ?? null;

    const opaqueRefreshToken = randomBytes(48).toString('base64url');
    const refreshTokenHash = this.hashToken(opaqueRefreshToken);
    const familyId = randomUUID();
    const expiresAt = this.computeRefreshExpiry();

    await this.prismaService.runInTransaction('ReadCommitted', async (tx) => {
      await tx.refreshSession.create({
        data: {
          userId: user.id,
          familyId,
          tokenHash: refreshTokenHash,
          expiresAt,
        },
      });

      await tx.securityAuditLog.create({
        data: {
          userId: user.id,
          eventType: 'USER_LOGIN_SUCCESS',
          ipAddress: ipAddress ?? null,
          details: { businessId, role: user.role },
        },
      });
    });

    const accessToken = await this.signAccessToken({
      sub: user.id,
      role: user.role as unknown as Role,
      businessId,
      tier,
      phoneE164: user.phoneE164,
    });

    return {
      accessToken,
      refreshToken: opaqueRefreshToken,
      tokenType: 'Bearer',
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
      user: {
        id: user.id,
        phoneE164: user.phoneE164,
        fullName: user.fullName,
        role: user.role as unknown as Role,
        businessId,
        tier,
        preferredLocale: user.preferredLocale,
      },
    };
  }

  async refresh(dto: RefreshTokenDto, ipAddress?: string): Promise<AuthTokenResponse> {
    const tokenHash = this.hashToken(dto.refreshToken);

    const session = await this.prismaService.refreshSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            ownedMerchants: {
              select: { id: true, tier: true },
              take: 1,
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!session || !session.user.isActive) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    // Strict reuse detection: if a previously rotated or revoked token is presented,
    // immediately revoke the entire session family and emit a security audit event.
    if (session.revokedAt !== null || session.replacedBy !== null) {
      await this.prismaService.runInTransaction('ReadCommitted', async (tx) => {
        await tx.refreshSession.updateMany({
          where: {
            familyId: session.familyId,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });

        await tx.securityAuditLog.create({
          data: {
            userId: session.userId,
            eventType: 'REFRESH_TOKEN_REUSE_DETECTED',
            ipAddress: ipAddress ?? null,
            details: {
              familyId: session.familyId,
              replayedSessionId: session.id,
            },
          },
        });

        await this.outboxService.enqueue(
          {
            aggregateType: 'RefreshSession',
            aggregateId: session.familyId,
            eventType: 'RefreshTokenReuseDetectedEvent',
            routingKey: 'security.refresh.reuse_detected',
            payload: {
              userId: session.userId,
              familyId: session.familyId,
              replayedSessionId: session.id,
            },
          },
          tx,
        );
      });

      throw new UnauthorizedException(
        'Refresh token reuse detected; session family revoked for security.',
      );
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prismaService.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token has expired.');
    }

    const nextOpaqueRefresh = randomBytes(48).toString('base64url');
    const nextHash = this.hashToken(nextOpaqueRefresh);
    const nextExpiresAt = this.computeRefreshExpiry();
    const nextSessionId = randomUUID();

    await this.prismaService.runInTransaction('Serializable', async (tx) => {
      await tx.refreshSession.create({
        data: {
          id: nextSessionId,
          userId: session.userId,
          familyId: session.familyId,
          tokenHash: nextHash,
          expiresAt: nextExpiresAt,
        },
      });

      await tx.refreshSession.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
          replacedBy: nextSessionId,
        },
      });
    });

    const primaryMerchant = session.user.ownedMerchants[0] ?? null;
    const businessId = primaryMerchant?.id ?? null;
    const tier = (primaryMerchant?.tier as MerchantTier | undefined) ?? null;

    const accessToken = await this.signAccessToken({
      sub: session.user.id,
      role: session.user.role as unknown as Role,
      businessId,
      tier,
      phoneE164: session.user.phoneE164,
    });

    return {
      accessToken,
      refreshToken: nextOpaqueRefresh,
      tokenType: 'Bearer',
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
      user: {
        id: session.user.id,
        phoneE164: session.user.phoneE164,
        fullName: session.user.fullName,
        role: session.user.role as unknown as Role,
        businessId,
        tier,
        preferredLocale: session.user.preferredLocale,
      },
    };
  }

  async logout(userId: string, dto: LogoutDto): Promise<{ revoked: boolean }> {
    const now = new Date();
    if (dto.refreshToken) {
      const tokenHash = this.hashToken(dto.refreshToken);
      const session = await this.prismaService.refreshSession.findUnique({
        where: { tokenHash },
        select: { id: true, familyId: true, userId: true },
      });

      if (session && session.userId === userId) {
        await this.prismaService.refreshSession.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
      }
    } else {
      await this.prismaService.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    }

    return { revoked: true };
  }

  async getMe(userId: string, tenantContext?: TenantContext) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneE164: true,
        fullName: true,
        role: true,
        preferredLocale: true,
        isActive: true,
        createdAt: true,
        ownedMerchants: {
          select: {
            id: true,
            smsShortCode: true,
            businessName: true,
            tier: true,
            ward: true,
            district: true,
            streetAddress: true,
            geospatialMapEnabled: true,
            isPlatformManaged: true,
          },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Authenticated user profile no longer exists.');
    }

    const { ownedMerchants, ...userSummary } = user;
    const businessProfile = ownedMerchants?.[0] ?? null;

    return {
      user: userSummary,
      businessProfile,
      tenantContext: tenantContext ?? null,
    };
  }

  private async signAccessToken(payload: {
    sub: string;
    role: Role;
    businessId: string | null;
    tier: MerchantTier | null;
    phoneE164: string;
  }): Promise<string> {
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    const expiresIn = this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
    return this.jwtService.signAsync(payload, {
      secret,
      expiresIn: expiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private computeRefreshExpiry(): Date {
    return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  private async assertNotBruteForceLocked(phoneE164: string, ipAddress?: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      const phoneKey = `auth:login:fail:phone:${phoneE164}`;
      const ipKey = ipAddress ? `auth:login:fail:ip:${ipAddress}` : null;

      const [phoneCountRaw, ipCountRaw] = await Promise.all([
        redis.get(phoneKey),
        ipKey ? redis.get(ipKey) : Promise.resolve(null),
      ]);

      const phoneCount = phoneCountRaw ? Number.parseInt(phoneCountRaw, 10) : 0;
      const ipCount = ipCountRaw ? Number.parseInt(ipCountRaw, 10) : 0;

      if (phoneCount >= MAX_FAILED_LOGIN_ATTEMPTS || ipCount >= MAX_FAILED_LOGIN_ATTEMPTS * 2) {
        throw new HttpException(
          'Too many failed login attempts. Account/IP temporarily locked for 15 minutes.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.warn(
        `Redis brute-force check skipped (unavailable): ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private async recordFailedLoginAttempt(
    phoneE164: string,
    ipAddress?: string,
    userId?: string | null,
  ): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      const phoneKey = `auth:login:fail:phone:${phoneE164}`;
      const count = await redis.incr(phoneKey);
      if (count === 1) {
        await redis.expire(phoneKey, LOGIN_LOCKOUT_WINDOW_SECONDS);
      }
      if (ipAddress) {
        const ipKey = `auth:login:fail:ip:${ipAddress}`;
        const ipCount = await redis.incr(ipKey);
        if (ipCount === 1) {
          await redis.expire(ipKey, LOGIN_LOCKOUT_WINDOW_SECONDS);
        }
      }
      if (count >= MAX_FAILED_LOGIN_ATTEMPTS) {
        await this.prismaService.securityAuditLog.create({
          data: {
            userId: userId ?? null,
            eventType: 'LOGIN_BRUTE_FORCE_LOCKOUT',
            ipAddress: ipAddress ?? null,
            details: { phoneE164, attemptCount: count },
          },
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to record login throttle counter: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private async clearFailedLoginAttempts(phoneE164: string, ipAddress?: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      const keys = [`auth:login:fail:phone:${phoneE164}`];
      if (ipAddress) {
        keys.push(`auth:login:fail:ip:${ipAddress}`);
      }
      await redis.del(...keys);
    } catch (error) {
      this.logger.warn(
        `Failed to clear login throttle counters: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
