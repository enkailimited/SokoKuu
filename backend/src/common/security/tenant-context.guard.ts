import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '@database/prisma.service';
import { AuthenticatedRequest, MerchantTier } from './auth.types';
import { IS_PUBLIC_KEY, TENANT_SCOPED_KEY } from './decorators';
import { Role } from './roles.enum';

interface TenantProfile {
  id: string;
  tier: string;
  isPlatformManaged: boolean;
  geospatialMapEnabled: boolean;
}

@Injectable()
export class TenantContextGuard implements CanActivate {
  private readonly logger = new Logger(TenantContextGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly prismaService?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const isTenantScoped = this.reflector.getAllAndOverride<boolean>(TENANT_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      return true;
    }

    const isSuperAdmin = user.role === Role.SUPER_ADMIN;

    let businessId: string | null = user.businessId ?? user.merchantId ?? null;
    let tier: MerchantTier | null = user.tier ?? null;
    let isPlatformManaged = true;
    let geospatialMapEnabled = isSuperAdmin;

    // Server-derived Merchant TenantContext lookup from business_profiles (never trust client headers/body)
    if (this.prismaService && typeof this.prismaService.businessProfile?.findFirst === 'function') {
      const profile = await this.findTenantProfile(user.sub);

      if (profile) {
        businessId = profile.id;
        tier = profile.tier as MerchantTier;
        isPlatformManaged = profile.isPlatformManaged;
        geospatialMapEnabled = isSuperAdmin ? true : profile.geospatialMapEnabled;
      }
    }

    request.tenantContext = {
      businessId,
      merchantId: businessId,
      tier,
      isPlatformManaged,
      geospatialMapEnabled,
      isSuperAdmin,
    };

    if (!isTenantScoped || isSuperAdmin) {
      return true;
    }

    if (!businessId) {
      throw new ForbiddenException(
        'Authenticated user does not hold an active Merchant tenant assignment.',
      );
    }

    const params = request.params as Record<string, string | undefined>;
    const query = request.query as Record<string, unknown>;
    const body = (request.body ?? {}) as Record<string, unknown>;

    const claimedTenantId =
      params?.merchantId ??
      params?.businessId ??
      (typeof query?.merchantId === 'string' ? query.merchantId : undefined) ??
      (typeof query?.businessId === 'string' ? query.businessId : undefined) ??
      (typeof body?.merchantId === 'string' ? body.merchantId : undefined) ??
      (typeof body?.businessId === 'string' ? body.businessId : undefined);

    if (claimedTenantId && claimedTenantId !== businessId) {
      throw new ForbiddenException(
        'Cross-tenant Merchant access denied: server-derived tenant mismatch.',
      );
    }

    return true;
  }

  /**
   * Neon's pooler can briefly drop a connection (cold start / scale-to-zero).
   * Retry only transient connection failures so a momentary network blip does
   * not surface as HTTP 500, while every other database error still propagates.
   */
  private async findTenantProfile(userId: string): Promise<TenantProfile | null> {
    const find = () =>
      this.prismaService!.businessProfile.findFirst({
        where: { ownerUserId: userId },
        select: {
          id: true,
          tier: true,
          isPlatformManaged: true,
          geospatialMapEnabled: true,
        },
      });

    const maxAttempts = 3;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await find();
      } catch (error) {
        if (attempt >= maxAttempts || !this.isTransientDatabaseError(error)) {
          throw error;
        }
        this.logger.warn(
          `Transient PostgreSQL error resolving Merchant tenant context (attempt ${attempt}/${maxAttempts}); retrying. ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        await this.waitBeforeRetry(attempt);
      }
    }
  }

  private isTransientDatabaseError(error: unknown): boolean {
    const code = (error as { code?: string } | null)?.code;
    const message = error instanceof Error ? error.message : String(error ?? '');
    return (
      code === 'P1001' ||
      code === 'P1002' ||
      code === 'P1008' ||
      code === 'P2024' ||
      /can'?t reach database server|database server.*(?:unreachable|not reachable)|connection (?:timed out|refused)/i.test(
        message,
      )
    );
  }

  private waitBeforeRetry(attempt: number): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, 150 * attempt));
  }
}
