import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MerchantTier, TenantContext } from '@common/security/auth.types';
import { PrismaService } from '@database/prisma.service';

@Injectable()
export class MerchantTenancyService {
  constructor(private readonly prismaService: PrismaService) {}

  async resolveMerchantTenantForUser(userId: string, isSuperAdmin: boolean): Promise<TenantContext> {
    const profile = await this.prismaService.businessProfile.findFirst({
      where: { ownerUserId: userId },
      select: {
        id: true,
        tier: true,
        isPlatformManaged: true,
        geospatialMapEnabled: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!profile) {
      return {
        businessId: null,
        merchantId: null,
        tier: null,
        isPlatformManaged: true,
        geospatialMapEnabled: isSuperAdmin,
        isSuperAdmin,
      };
    }

    return {
      businessId: profile.id,
      merchantId: profile.id,
      tier: profile.tier as MerchantTier,
      isPlatformManaged: profile.isPlatformManaged,
      geospatialMapEnabled: isSuperAdmin ? true : profile.geospatialMapEnabled,
      isSuperAdmin,
    };
  }

  async requireMerchantProfile(businessId: string) {
    const profile = await this.prismaService.businessProfile.findUnique({
      where: { id: businessId },
    });
    if (!profile) {
      throw new NotFoundException(`Merchant profile ${businessId} was not found.`);
    }
    return profile;
  }

  assertActiveMerchantContext(tenantContext?: TenantContext): string {
    if (!tenantContext?.businessId) {
      throw new ForbiddenException(
        'Active Merchant tenant context is required for this operation.',
      );
    }
    return tenantContext.businessId;
  }
}
