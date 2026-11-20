import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { MerchantTier, TenantContext } from '@common/security/auth.types';
import { Role } from '@common/security/roles.enum';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { OutboundSmsService } from '@modules/13-notifications/outbound-sms.service';
import { RedisService } from '@redis/redis.service';
import {
  LoginDto,
  LogoutDto,
  RefreshTokenDto,
  RegisterDto,
  RegistrationChallengeDto,
} from './dto/auth.dto';

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_THROTTLE_WINDOW_SECONDS = 900; // 15 minutes
const REFRESH_TTL_DAYS = 7;
const REGISTRATION_OTP_TTL_SECONDS = 300; // 5 minutes
const REGISTRATION_OTP_MAX_ATTEMPTS = 5;
const REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS = 60;
const REGISTRATION_OTP_MAX_PER_HOUR = 3;
const USER_REVOCATION_TTL_SECONDS = 15 * 60; // matches maximum access-token lifetime

// Privileged roles are never self-assignable. The DTO already restricts the
// public surface; this set is a defence-in-depth check inside the service.
const NON_SELF_REGISTRABLE_ROLES = new Set<Role>([Role.SUPER_ADMIN]);

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
    private readonly outboundSmsService: OutboundSmsService,
  ) {}

  /**
   * Step 1 of registration: prove ownership of the Tanzanian MSISDN.
   * A short-lived, hashed one-time code is sent over NextSMS. The raw code is
   * never persisted; in non-production environments it is returned to the
   * caller so local development and automated tests remain possible.
   */
  async requestRegistrationChallenge(
    dto: RegistrationChallengeDto,
    ipAddress?: string,
  ): Promise<{
    phoneE164: string;
    expiresInSeconds: number;
    devCode?: string;
  }> {
    const redis = this.redisService.getClient();
    const cooldownKey = `auth:register:otp:cooldown:${dto.phoneE164}`;
    const countKey = `auth:register:otp:count:${dto.phoneE164}`;
    const hashKey = `auth:register:otp:hash:${dto.phoneE164}`;
    const attemptsKey = `auth:register:otp:attempts:${dto.phoneE164}`;

    let redisAvailable = true;
    try {
      const cooldown = await redis.get(cooldownKey);
      if (cooldown) {
        throw new HttpException(
          'Verification code was sent recently. Please wait before requesting another.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const rawCount = await redis.get(countKey);
      const requested = rawCount ? Number.parseInt(rawCount, 10) : 0;
      if (requested >= REGISTRATION_OTP_MAX_PER_HOUR) {
        throw new HttpException(
          'Too many verification requests for this number. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      redisAvailable = false;
      this.logger.warn(
        `Registration OTP pre-check failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }

    if (!redisAvailable) {
      if (this.isProductionEnv()) {
        throw new ServiceUnavailableException('Verification service is temporarily unavailable.');
      }
      if (this.getFallbackValue(cooldownKey)) {
        throw new HttpException(
          'Verification code was sent recently. Please wait before requesting another.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const rawCount = this.getFallbackValue(countKey);
      const requested = rawCount ? Number.parseInt(rawCount, 10) : 0;
      if (requested >= REGISTRATION_OTP_MAX_PER_HOUR) {
        throw new HttpException(
          'Too many verification requests for this number. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = this.hashToken(code);
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const message = `SokoKuu verification code: ${code}. Valid for 5 minutes. Never share it.`;

    try {
      const delivered = await this.outboundSmsService.queueAndDispatchSms({
        recipientPhoneE164: dto.phoneE164,
        messageBody: message,
      });

      if (delivered.status !== 'SENT' && isProduction) {
        throw new ServiceUnavailableException(
          'Verification SMS could not be delivered. Please try again shortly.',
        );
      }

      if (redisAvailable) {
        await redis.set(hashKey, codeHash, 'EX', REGISTRATION_OTP_TTL_SECONDS);
        await redis.del(attemptsKey);
        await redis.set(
          cooldownKey,
          '1',
          'EX',
          REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS,
        );
        const count = await redis.incr(countKey);
        if (count === 1) {
          await redis.expire(countKey, 60 * 60);
        }
      } else {
        this.setFallbackValue(hashKey, codeHash, REGISTRATION_OTP_TTL_SECONDS);
        this.fallbackKv.delete(attemptsKey);
        this.setFallbackValue(cooldownKey, '1', REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS);
        this.incrFallbackValue(countKey, 60 * 60);
      }

      await this.prismaService.securityAuditLog.create({
        data: {
          eventType: 'REGISTRATION_OTP_REQUESTED',
          ipAddress: ipAddress ?? null,
          details: { phoneE164: dto.phoneE164, delivered: delivered.status },
        },
      });

      this.logger.log(
        `[REGISTRATION-OTP] phone=${dto.phoneE164.slice(0, 6)}**** delivered=${delivered.status}`,
      );

      return {
        phoneE164: dto.phoneE164,
        expiresInSeconds: REGISTRATION_OTP_TTL_SECONDS,
        ...(!isProduction && delivered.status !== 'SENT' ? { devCode: code } : {}),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `Registration OTP dispatch failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new ServiceUnavailableException('Verification service is temporarily unavailable.');
    }
  }

  async register(dto: RegisterDto, ipAddress?: string): Promise<AuthTokenResponse> {
    if (NON_SELF_REGISTRABLE_ROLES.has(dto.role as unknown as Role)) {
      throw new ForbiddenException('This role cannot be self-registered.');
    }
    await this.consumeRegistrationChallenge(dto.phoneE164, dto.verificationCode);

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

    const isMerchantRole = dto.role === 'WHOLESALER' || dto.role === 'RETAILER' || dto.role === 'SUPPLIER';

    let createdBusinessId: string | null = null;
    let createdTier: string | null = null;

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

      if (isMerchantRole && tx?.businessProfile?.create) {
        const smsShortCode = await this.generateUniqueSmsShortCode(tx);
        const tier =
          dto.role === 'WHOLESALER'
            ? 'WHOLESALE'
            : dto.role === 'RETAILER'
              ? 'RETAIL_DUKA'
              : 'MANUFACTURER_SUPPLIER';

        const businessProfile = await tx.businessProfile.create({
          data: {
            ownerUserId: created.id,
            smsShortCode,
            businessName: dto.fullName.trim(),
            tier: tier as any,
            streetAddress: 'Not provided',
            ward: 'Dar es Salaam',
            district: 'Dar es Salaam',
            latitude: -6.816,
            longitude: 39.28,
            isOpen: false,
            isPlatformManaged: true,
            logoCdnUrl: 'https://ik.imagekit.io/ochspoiwa/sokokuutz/catalog/default-merchant.webp',
          },
        });

        createdBusinessId = businessProfile.id;
        createdTier = businessProfile.tier;
      }

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
      businessId: createdBusinessId,
      tier: createdTier as MerchantTier | null,
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
        businessId: createdBusinessId,
        tier: createdTier as MerchantTier | null,
        preferredLocale: user.preferredLocale,
      },
    };
  }

  async login(dto: LoginDto, ipAddress?: string): Promise<AuthTokenResponse> {
    await this.assertLoginAttemptAllowed(dto.phoneE164, ipAddress);

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
    if (!dto.refreshToken) {
      throw new UnauthorizedException('Invalid refresh token.');
    }
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
            logoCdnUrl: true,
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

  async updateMerchantShopImage(userId: string, logoCdnUrl: string) {
    const merchant = await this.prismaService.businessProfile.findFirst({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (!merchant) {
      throw new ForbiddenException(
        'Only an authenticated merchant account can update its shop image.',
      );
    }

    const updated = await this.prismaService.businessProfile.update({
      where: { id: merchant.id },
      data: { logoCdnUrl },
      select: { id: true, logoCdnUrl: true },
    });

    return {
      merchantId: updated.id,
      logoCdnUrl: updated.logoCdnUrl,
    };
  }

  async updateProfile(
    userId: string,
    dto: {
      fullName?: string;
      preferredLocale?: 'sw' | 'en';
      businessName?: string;
      ward?: string;
      district?: string;
      streetAddress?: string;
    },
    tenantContext?: TenantContext,
  ) {
    await this.prismaService.runInTransaction('ReadCommitted', async (tx) => {
      const userData: { fullName?: string; preferredLocale?: string } = {};
      if (dto.fullName?.trim()) userData.fullName = dto.fullName.trim();
      if (dto.preferredLocale) userData.preferredLocale = dto.preferredLocale;

      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: userId }, data: userData });
      }

      const businessData: {
        businessName?: string;
        ward?: string;
        district?: string;
        streetAddress?: string;
      } = {};
      if (dto.businessName?.trim()) businessData.businessName = dto.businessName.trim();
      if (dto.ward?.trim()) businessData.ward = dto.ward.trim();
      if (dto.district?.trim()) businessData.district = dto.district.trim();
      if (dto.streetAddress?.trim()) businessData.streetAddress = dto.streetAddress.trim();

      if (Object.keys(businessData).length > 0) {
        let businessId = tenantContext?.businessId ?? null;
        if (!businessId) {
          const owned = await tx.businessProfile.findFirst({
            where: { ownerUserId: userId },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          businessId = owned?.id ?? null;
        }
        if (businessId) {
          await tx.businessProfile.update({
            where: { id: businessId },
            data: businessData,
          });
        }
      }
    });

    return this.getMe(userId, tenantContext);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Authenticated user profile no longer exists.');
    }

    const passwordValid = await argon2.verify(user.passwordHash, currentPassword);
    if (!passwordValid) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });

    await this.prismaService.runInTransaction('ReadCommitted', async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });
      await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (tx.securityAuditLog && typeof tx.securityAuditLog.create === 'function') {
        await tx.securityAuditLog.create({
          data: {
            userId,
            eventType: 'USER_PASSWORD_CHANGED',
            details: { requiresRelogin: true },
          },
        });
      }
    });

    return { changed: true, requiresRelogin: true };
  }

  async requestPasswordResetChallenge(dto: { phoneE164: string }) {
    const redis = this.redisService.getClient();
    const cooldownKey = `auth:reset:otp:cooldown:${dto.phoneE164}`;
    const countKey = `auth:reset:otp:count:${dto.phoneE164}`;
    const hashKey = `auth:reset:otp:hash:${dto.phoneE164}`;
    const attemptsKey = `auth:reset:otp:attempts:${dto.phoneE164}`;

    // Avoid account enumeration: always respond with the same envelope.
    const user = await this.prismaService.user.findUnique({
      where: { phoneE164: dto.phoneE164 },
      select: { id: true, isActive: true },
    });

    const code = String(randomInt(100000, 1000000));
    const codeHash = this.hashToken(code);
    const isDevLike = !this.isProductionEnv();

    if (user && user.isActive) {
      let redisAvailable = true;
      try {
        const cooldown = await redis.ttl(cooldownKey);
        if (cooldown > 0) {
          throw new HttpException(
            `Please wait ${cooldown}s before requesting another code.`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        const requested = Number.parseInt((await redis.get(countKey)) ?? '0', 10);
        if (requested >= REGISTRATION_OTP_MAX_PER_HOUR) {
          throw new HttpException(
            'Too many reset codes requested. Please try again later.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      } catch (error) {
        if (error instanceof HttpException) throw error;
        if (this.isProductionEnv()) {
          throw new ServiceUnavailableException('Password reset is temporarily unavailable.');
        }
        redisAvailable = false;
      }

      try {
        await this.outboundSmsService.queueAndDispatchSms({
          recipientPhoneE164: dto.phoneE164,
          messageBody: `SokoKuu: Nambari yako ya kubadilisha nywila ni ${code}. Itakwisha baada ya dakika 5.`,
          maxAttempts: 3,
        });
      } catch (error) {
        if (this.isProductionEnv()) {
          this.logger.error(
            `Failed to send password reset OTP: ${error instanceof Error ? error.message : 'unknown'}`,
          );
        }
      }

      try {
        if (redisAvailable) {
          await redis.set(hashKey, codeHash, 'EX', REGISTRATION_OTP_TTL_SECONDS);
          await redis.set(attemptsKey, '0', 'EX', REGISTRATION_OTP_TTL_SECONDS);
          await redis.set(cooldownKey, '1', 'EX', REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS);
          const count = await redis.incr(countKey);
          if (count === 1) {
            await redis.expire(countKey, 3600);
          }
        } else {
          this.setFallbackValue(hashKey, codeHash, REGISTRATION_OTP_TTL_SECONDS);
          this.setFallbackValue(attemptsKey, '0', REGISTRATION_OTP_TTL_SECONDS);
          this.setFallbackValue(cooldownKey, '1', REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS);
          this.incrFallbackValue(countKey, 3600);
        }
      } catch (error) {
        if (this.isProductionEnv()) {
          throw new ServiceUnavailableException('Password reset is temporarily unavailable.');
        }
      }
    }

    return {
      phoneE164: dto.phoneE164,
      expiresInSeconds: REGISTRATION_OTP_TTL_SECONDS,
      ...(isDevLike && user && user.isActive ? { devCode: code } : {}),
    };
  }

  async confirmPasswordReset(dto: {
    phoneE164: string;
    verificationCode: string;
    newPassword: string;
  }) {
    await this.consumePasswordResetChallenge(dto.phoneE164, dto.verificationCode);

    const user = await this.prismaService.user.findUnique({
      where: { phoneE164: dto.phoneE164 },
      select: { id: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new BadRequestException('Password reset could not be completed for this account.');
    }

    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });

    await this.prismaService.runInTransaction('ReadCommitted', async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      await tx.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (tx.securityAuditLog && typeof tx.securityAuditLog.create === 'function') {
        await tx.securityAuditLog.create({
          data: {
            userId: user.id,
            eventType: 'USER_PASSWORD_RESET',
            details: { via: 'sms_otp' },
          },
        });
      }
    });

    return { reset: true };
  }

  private async consumePasswordResetChallenge(phoneE164: string, code: string): Promise<void> {
    const redis = this.redisService.getClient();
    const hashKey = `auth:reset:otp:hash:${phoneE164}`;
    const attemptsKey = `auth:reset:otp:attempts:${phoneE164}`;

    let redisAvailable = true;
    let storedHash: string | null = null;
    let attempts = 0;
    try {
      storedHash = await redis.get(hashKey);
      const rawAttempts = await redis.get(attemptsKey);
      attempts = rawAttempts ? Number.parseInt(rawAttempts, 10) : 0;
    } catch (error) {
      this.logger.warn(
        `Password reset OTP verification unavailable: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      if (this.isProductionEnv()) {
        throw new ServiceUnavailableException('Verification service is temporarily unavailable.');
      }
      redisAvailable = false;
      storedHash = this.getFallbackValue(hashKey);
      const rawAttempts = this.getFallbackValue(attemptsKey);
      attempts = rawAttempts ? Number.parseInt(rawAttempts, 10) : 0;
    }

    if (!storedHash) {
      throw new BadRequestException(
        'Verification code expired or was never requested. Please request a new code.',
      );
    }
    if (attempts >= REGISTRATION_OTP_MAX_ATTEMPTS) {
      if (redisAvailable) {
        try {
          await redis.del(hashKey, attemptsKey);
        } catch {
          // best-effort cleanup
        }
      } else {
        this.fallbackKv.delete(hashKey);
        this.fallbackKv.delete(attemptsKey);
      }
      throw new BadRequestException(
        'Too many incorrect verification codes. Please request a new code.',
      );
    }

    const presentedHash = this.hashToken(code);
    const matches =
      presentedHash.length === storedHash.length &&
      timingSafeEqual(Buffer.from(presentedHash, 'utf8'), Buffer.from(storedHash, 'utf8'));

    if (!matches) {
      if (redisAvailable) {
        try {
          const next = await redis.incr(attemptsKey);
          if (next === 1) {
            await redis.expire(attemptsKey, REGISTRATION_OTP_TTL_SECONDS);
          }
        } catch {
          if (this.isProductionEnv()) {
            throw new ServiceUnavailableException('Verification service is temporarily unavailable.');
          }
          this.incrFallbackValue(attemptsKey, REGISTRATION_OTP_TTL_SECONDS);
        }
      } else {
        this.incrFallbackValue(attemptsKey, REGISTRATION_OTP_TTL_SECONDS);
      }
      throw new BadRequestException('Incorrect verification code.');
    }

    if (redisAvailable) {
      try {
        await redis.del(hashKey, attemptsKey);
      } catch {
        if (this.isProductionEnv()) {
          throw new ServiceUnavailableException('Verification service is temporarily unavailable.');
        }
        this.fallbackKv.delete(hashKey);
        this.fallbackKv.delete(attemptsKey);
      }
    } else {
      this.fallbackKv.delete(hashKey);
      this.fallbackKv.delete(attemptsKey);
    }
  }

  private async generateUniqueSmsShortCode(tx: any): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = `SK${Math.floor(1000 + Math.random() * 9000)}`;
      if (tx?.businessProfile?.findUnique) {
        const existing = await tx.businessProfile.findUnique({
          where: { smsShortCode: code },
          select: { id: true },
        });
        if (existing) continue;
      }
      return code;
    }
    return `SK${Date.now().toString().slice(-4)}`;
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
    // A unique jti lets logout revoke an individual access token immediately
    // instead of waiting for the 15-minute natural expiry.
    return this.jwtService.signAsync(
      { ...payload, jti: randomUUID() },
      {
        secret,
        expiresIn: expiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );
  }

  revokeAccessToken(jti: string | undefined, userId: string | undefined): void {
    if (!jti && !userId) return;
    const revokedUntil = Date.now() + USER_REVOCATION_TTL_SECONDS * 1000;
    if (jti) {
      this.revokedJtiCache.set(jti, revokedUntil);
      void this.redisSafeSet(
        `auth:access:revoked:${jti}`,
        '1',
        USER_REVOCATION_TTL_SECONDS,
      );
    }
    if (userId) {
      this.revokedUserCache.set(userId, revokedUntil);
      void this.redisSafeSet(
        `auth:user:revoked:${userId}`,
        '1',
        USER_REVOCATION_TTL_SECONDS,
      );
    }
  }

  async isAccessTokenRevoked(jti?: string, userId?: string): Promise<boolean> {
    const now = Date.now();
    if (jti && (this.revokedJtiCache.get(jti) ?? 0) > now) return true;
    if (userId && (this.revokedUserCache.get(userId) ?? 0) > now) return true;

    if (!jti && !userId) return false;
    const redis = this.redisService.getClient();
    try {
      const keys = [
        ...(jti ? [`auth:access:revoked:${jti}`] : []),
        ...(userId ? [`auth:user:revoked:${userId}`] : []),
      ];
      const values = await Promise.all(keys.map((key) => redis.get(key)));
      return values.some((value) => value !== null);
    } catch (error) {
      // Redis outage must not silently widen access. The in-memory cache still
      // covers tokens revoked by this process; other processes will rely on
      // their own cache until Redis returns.
      this.logger.warn(
        `Access-token revocation check degraded: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return false;
    }
  }

  private readonly revokedJtiCache = new Map<string, number>();
  private readonly revokedUserCache = new Map<string, number>();
  private readonly fallbackKv = new Map<string, { value: string; expiresAt: number }>();

  private isProductionEnv(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  private getFallbackValue(key: string): string | null {
    const entry = this.fallbackKv.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.fallbackKv.delete(key);
      return null;
    }
    return entry.value;
  }

  private setFallbackValue(key: string, value: string, ttlSeconds: number): void {
    this.fallbackKv.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  private incrFallbackValue(key: string, defaultTtlSeconds: number): number {
    const existing = this.getFallbackValue(key);
    const next = (existing ? Number.parseInt(existing, 10) : 0) + 1;
    const prevEntry = this.fallbackKv.get(key);
    const expiresAt =
      prevEntry && prevEntry.expiresAt > Date.now()
        ? prevEntry.expiresAt
        : Date.now() + defaultTtlSeconds * 1000;
    this.fallbackKv.set(key, { value: String(next), expiresAt });
    return next;
  }

  private async redisSafeSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      await redis.set(key, value, 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `Failed to persist token revocation: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private async consumeRegistrationChallenge(phoneE164: string, code: string): Promise<void> {
    const redis = this.redisService.getClient();
    const hashKey = `auth:register:otp:hash:${phoneE164}`;
    const attemptsKey = `auth:register:otp:attempts:${phoneE164}`;

    let redisAvailable = true;
    let storedHash: string | null = null;
    let attempts = 0;
    try {
      storedHash = await redis.get(hashKey);
      const rawAttempts = await redis.get(attemptsKey);
      attempts = rawAttempts ? Number.parseInt(rawAttempts, 10) : 0;
    } catch (error) {
      this.logger.warn(
        `Registration OTP verification unavailable: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      if (this.isProductionEnv()) {
        throw new ServiceUnavailableException('Verification service is temporarily unavailable.');
      }
      redisAvailable = false;
      storedHash = this.getFallbackValue(hashKey);
      const rawAttempts = this.getFallbackValue(attemptsKey);
      attempts = rawAttempts ? Number.parseInt(rawAttempts, 10) : 0;
    }

    if (!storedHash) {
      throw new BadRequestException(
        'Verification code expired or was never requested. Please request a new code.',
      );
    }
    if (attempts >= REGISTRATION_OTP_MAX_ATTEMPTS) {
      if (redisAvailable) {
        try {
          await redis.del(hashKey, attemptsKey);
        } catch {
          // best-effort cleanup
        }
      } else {
        this.fallbackKv.delete(hashKey);
        this.fallbackKv.delete(attemptsKey);
      }
      throw new BadRequestException(
        'Too many incorrect verification codes. Please request a new code.',
      );
    }

    const presentedHash = this.hashToken(code);
    const matches =
      presentedHash.length === storedHash.length &&
      timingSafeEqual(Buffer.from(presentedHash, 'utf8'), Buffer.from(storedHash, 'utf8'));

    if (!matches) {
      if (redisAvailable) {
        try {
          const next = await redis.incr(attemptsKey);
          if (next === 1) {
            await redis.expire(attemptsKey, REGISTRATION_OTP_TTL_SECONDS);
          }
        } catch {
          if (this.isProductionEnv()) {
            throw new ServiceUnavailableException('Verification service is temporarily unavailable.');
          }
          this.incrFallbackValue(attemptsKey, REGISTRATION_OTP_TTL_SECONDS);
        }
      } else {
        this.incrFallbackValue(attemptsKey, REGISTRATION_OTP_TTL_SECONDS);
      }
      throw new BadRequestException('Incorrect verification code.');
    }

    if (redisAvailable) {
      try {
        await redis.del(hashKey, attemptsKey);
      } catch {
        if (this.isProductionEnv()) {
          throw new ServiceUnavailableException('Verification service is temporarily unavailable.');
        }
        this.fallbackKv.delete(hashKey);
        this.fallbackKv.delete(attemptsKey);
      }
    } else {
      this.fallbackKv.delete(hashKey);
      this.fallbackKv.delete(attemptsKey);
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private computeRefreshExpiry(): Date {
    return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  /**
   * Throttle failures per (network, phone-number) pair rather than per account
   * alone. An attacker cannot lock a victim out by guessing from another IP,
   * and a shared NAT cannot lock every user behind it. Broad IP volume is
   * handled by the route-specific ThrottlerGuard instead.
   */
  private loginFailureKey(phoneE164: string, ipAddress?: string): string {
    const composite = `${ipAddress ?? 'unknown'}|${phoneE164}`;
    return `auth:login:fail:${createHash('sha256').update(composite, 'utf8').digest('hex')}`;
  }

  private async assertLoginAttemptAllowed(phoneE164: string, ipAddress?: string): Promise<void> {
    const redis = this.redisService.getClient();
    const key = this.loginFailureKey(phoneE164, ipAddress);
    let attempts = 0;
    try {
      const raw = await redis.get(key);
      attempts = raw ? Number.parseInt(raw, 10) : 0;
    } catch (error) {
      this.logger.warn(
        `Login throttle store unavailable: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      if (this.isProductionEnv()) {
        throw new ServiceUnavailableException('Sign-in is temporarily unavailable. Please retry.');
      }
      const raw = this.getFallbackValue(key);
      attempts = raw ? Number.parseInt(raw, 10) : 0;
    }

    if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      throw new HttpException(
        'Too many failed sign-in attempts from this device/network. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordFailedLoginAttempt(
    phoneE164: string,
    ipAddress?: string,
    userId?: string | null,
  ): Promise<void> {
    const redis = this.redisService.getClient();
    const key = this.loginFailureKey(phoneE164, ipAddress);
    let count = 0;
    try {
      count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, LOGIN_THROTTLE_WINDOW_SECONDS);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to record login throttle counter: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      if (this.isProductionEnv()) {
        throw new ServiceUnavailableException('Sign-in is temporarily unavailable. Please retry.');
      }
      count = this.incrFallbackValue(key, LOGIN_THROTTLE_WINDOW_SECONDS);
    }

    if (count >= MAX_FAILED_LOGIN_ATTEMPTS) {
      await this.prismaService.securityAuditLog.create({
        data: {
          userId: userId ?? null,
          eventType: 'LOGIN_BRUTE_FORCE_THROTTLED',
          ipAddress: ipAddress ?? null,
          details: { phoneE164, attemptCount: count },
        },
      });
    }
  }

  private async clearFailedLoginAttempts(phoneE164: string, ipAddress?: string): Promise<void> {
    const redis = this.redisService.getClient();
    const key = this.loginFailureKey(phoneE164, ipAddress);
    this.fallbackKv.delete(key);
    try {
      await redis.del(key);
    } catch (error) {
      // A successful login must never fail because the counter could not be
      // cleared; the counter simply expires on its own.
      this.logger.warn(
        `Failed to clear login throttle counter: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
