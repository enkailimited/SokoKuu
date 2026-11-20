import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MerchantTier, TenantContext } from '@common/security/auth.types';
import { PrismaService } from '@database/prisma.service';
import { UpdateMerchantProfileLocationDto } from './dto/merchant-profile-location.dto';

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

  assertTenantContextForWrite(tenantContext?: TenantContext): string {
    if (!tenantContext?.businessId) {
      throw new ForbiddenException(
        'Merchant-only operation: server could not derive a valid tenant (business) context.',
      );
    }
    return tenantContext.businessId;
  }

  async assertBusinessExists(businessId: string): Promise<void> {
    const business = await this.prismaService.businessProfile.findUnique({
      where: { id: businessId },
      select: { id: true },
    });

    if (!business) {
      throw new NotFoundException(`Merchant profile ${businessId} was not found.`);
    }
  }

  async getMerchantLocation(tenantContext?: TenantContext) {
    const businessId = this.assertTenantContextForWrite(tenantContext);
    const profile = await this.prismaService.businessProfile.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        businessName: true,
        latitude: true,
        longitude: true,
        ward: true,
        district: true,
        streetAddress: true,
        wardName: true,
        streetLandmark: true,
        routeWaypoints: true,
      },
    });

    if (!profile) {
      throw new NotFoundException(`Merchant profile ${businessId} was not found.`);
    }

    return {
      merchantId: profile.id,
      businessName: profile.businessName,
      latitude: Number(profile.latitude),
      longitude: Number(profile.longitude),
      ward: profile.ward,
      district: profile.district,
      streetAddress: profile.streetAddress,
      wardName: profile.wardName ?? profile.ward,
      streetLandmark: profile.streetLandmark ?? profile.streetAddress,
      routeWaypoints: Array.isArray(profile.routeWaypoints) ? profile.routeWaypoints : [],
    };
  }

  async updateMerchantLocation(dto: UpdateMerchantProfileLocationDto, tenantContext?: TenantContext) {
    const businessId = this.assertTenantContextForWrite(tenantContext);

    const existing = await this.prismaService.businessProfile.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        latitude: true,
        longitude: true,
      },
    });
    if (!existing) {
      throw new NotFoundException(`Merchant profile ${businessId} was not found.`);
    }

    const latitude =
      dto.latitude !== undefined ? dto.latitude : Number(existing.latitude);
    const longitude =
      dto.longitude !== undefined ? dto.longitude : Number(existing.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new BadRequestException('Latitude/longitude lazima ziwe namba halali za GPS.');
    }

    const data: Prisma.BusinessProfileUpdateInput = {
      latitude,
      longitude,
    };
    if (dto.wardName !== undefined) data.wardName = dto.wardName.trim() || null;
    if (dto.streetLandmark !== undefined) data.streetLandmark = dto.streetLandmark.trim() || null;
    if (dto.routeWaypoints !== undefined) {
      data.routeWaypoints = dto.routeWaypoints as unknown as Prisma.InputJsonValue;
    }

    await this.prismaService.$transaction(async (tx) => {
      await tx.businessProfile.update({
        where: { id: businessId },
        data,
      });
      await tx.$executeRaw`
        UPDATE business_profiles
           SET location = ST_SetSRID(ST_MakePoint(${longitude}::double precision, ${latitude}::double precision), 4326)::geography
         WHERE id = ${businessId}::uuid
      `;
    });

    return this.getMerchantLocation(tenantContext);
  }
}
