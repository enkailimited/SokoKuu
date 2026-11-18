import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BusinessTier, Prisma } from '@prisma/client';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { ListMerchantsQueryDto } from './dto/platform-admin.dto';

export interface MerchantDirectoryRecord {
  merchantId: string;
  smsShortCode: string;
  merchantName: string;
  tier: string;
  ward: string;
  district: string;
  streetAddress: string;
  latitude: number;
  longitude: number;
  isOpen: boolean;
  isPlatformManaged: boolean;
  geospatialMapEnabled: boolean;
  owner: {
    userId: string;
    fullName: string;
    phoneE164: string;
  };
  createdAt: string;
}

@Injectable()
export class AdminMerchantsService {
  private readonly logger = new Logger(AdminMerchantsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  async listMerchants(query: ListMerchantsQueryDto): Promise<{
    count: number;
    merchants: MerchantDirectoryRecord[];
  }> {
    const where: Prisma.BusinessProfileWhereInput = {};
    if (query.tier) {
      where.tier = query.tier as unknown as BusinessTier;
    }
    if (query.district) {
      where.district = { equals: query.district.trim(), mode: 'insensitive' };
    }
    if (query.ward) {
      where.ward = { equals: query.ward.trim(), mode: 'insensitive' };
    }
    if (typeof query.isPlatformManaged === 'boolean') {
      where.isPlatformManaged = query.isPlatformManaged;
    }

    const rows = await this.prismaService.businessProfile.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            fullName: true,
            phoneE164: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const merchants: MerchantDirectoryRecord[] = rows.map((row) => ({
      merchantId: row.id,
      smsShortCode: row.smsShortCode,
      merchantName: row.businessName,
      tier: row.tier,
      ward: row.ward,
      district: row.district,
      streetAddress: row.streetAddress,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      isOpen: row.isOpen,
      isPlatformManaged: row.isPlatformManaged,
      geospatialMapEnabled: row.geospatialMapEnabled,
      owner: {
        userId: row.owner.id,
        fullName: row.owner.fullName,
        phoneE164: row.owner.phoneE164,
      },
      createdAt: row.createdAt.toISOString(),
    }));

    return {
      count: merchants.length,
      merchants,
    };
  }

  async setPlatformManagedFlag(
    businessId: string,
    isPlatformManaged: boolean,
    adminUserId: string,
  ) {
    return this.prismaService.runInTransaction('RepeatableRead', async (tx) => {
      const existing = await tx.businessProfile.findUnique({
        where: { id: businessId },
        select: { id: true, businessName: true, isPlatformManaged: true },
      });

      if (!existing) {
        throw new NotFoundException(`Merchant profile ${businessId} was not found.`);
      }

      const updated = await tx.businessProfile.update({
        where: { id: businessId },
        data: {
          isPlatformManaged,
          version: { increment: 1 },
        },
        select: {
          id: true,
          businessName: true,
          isPlatformManaged: true,
          updatedAt: true,
        },
      });

      await this.outboxService.enqueue(
        {
          aggregateType: 'BusinessProfile',
          aggregateId: updated.id,
          eventType: 'MerchantPlatformManagedToggledEvent',
          routingKey: 'admin.merchant.platform_managed_toggled',
          payload: {
            merchantId: updated.id,
            merchantName: updated.businessName,
            isPlatformManaged: updated.isPlatformManaged,
            updatedByAdminId: adminUserId,
          },
        },
        tx,
      );

      this.logger.log(
        `[ADMIN-MERCHANT] merchantId=${updated.id} isPlatformManaged=${updated.isPlatformManaged}`,
      );

      return {
        merchantId: updated.id,
        merchantName: updated.businessName,
        isPlatformManaged: updated.isPlatformManaged,
        updatedAtEat: updated.updatedAt.toISOString(),
      };
    });
  }

  async setGeospatialMapEnabled(tenantBusinessId: string, enabled: boolean) {
    return this.prismaService.runInTransaction('RepeatableRead', async (tx) => {
      const existing = await tx.businessProfile.findUnique({
        where: { id: tenantBusinessId },
        select: { id: true, businessName: true },
      });

      if (!existing) {
        throw new NotFoundException(
          'Hifadhidata ya SokoKuu: Merchant profile haikupatikana.',
        );
      }

      const updated = await tx.businessProfile.update({
        where: { id: tenantBusinessId },
        data: {
          geospatialMapEnabled: enabled,
          version: { increment: 1 },
        },
        select: {
          id: true,
          businessName: true,
          geospatialMapEnabled: true,
          updatedAt: true,
        },
      });

      this.logger.log(
        `[SOKOKUU-GEO-TOGGLE] engine=SOKOKUU_CLOUD_SQL_CLUSTER merchant=${updated.id} geospatial_map_enabled=${updated.geospatialMapEnabled}`,
      );

      return {
        tenantBusinessId: updated.id,
        merchantId: updated.id,
        merchantName: updated.businessName,
        geospatialMapEnabled: updated.geospatialMapEnabled,
        storageCluster: 'SokoKuu Cloud SQL Database Cluster',
        updatedAtEat: updated.updatedAt.toISOString(),
      };
    });
  }

  async getPlatformMetrics() {
    const [
      totalMerchants,
      managedMerchants,
      geoEnabledMerchants,
      totalUsers,
      totalCatalogEntries,
      totalCatalogCategories,
      totalActiveProducts,
      totalOrders,
      pendingDispatchedTraces,
      disputedLedgers,
      totalLeads,
      convertedLeads,
      pendingOutboxEvents,
      deadLetterOutboxEvents,
      smsSentCount,
    ] = await Promise.all([
      this.prismaService.businessProfile.count(),
      this.prismaService.businessProfile.count({ where: { isPlatformManaged: true } }),
      this.prismaService.businessProfile.count({ where: { geospatialMapEnabled: true } }),
      this.prismaService.user.count(),
      this.prismaService.sokoGlobalCatalog.count(),
      this.prismaService.sokoCatalogCategory.count(),
      this.prismaService.product.count({ where: { isActive: true } }),
      this.prismaService.order.count(),
      this.prismaService.orderDispatchAuditTrace.count({
        where: { helpdeskStatus: 'OPEN' },
      }),
      this.prismaService.cashDeliveryLedger.count({
        where: { verificationStatus: 'DISPUTED' },
      }),
      this.prismaService.sokoLead.count(),
      this.prismaService.sokoLead.count({ where: { status: 'CONVERTED' } }),
      this.prismaService.domainOutboxEvent.count({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
      }),
      this.prismaService.domainOutboxEvent.count({
        where: { status: 'DEAD_LETTER' },
      }),
      this.prismaService.smsDeliveryLog.count(),
    ]);

    return {
      totalMerchants,
      managedMerchants,
      geoEnabledMerchants,
      totalUsers,
      totalCatalogEntries,
      totalCatalogCategories,
      totalActiveProducts,
      totalOrders,
      pendingDispatchedTraces,
      disputedLedgers,
      totalLeads,
      convertedLeads,
      pendingOutboxEvents,
      deadLetterOutboxEvents,
      smsSentCount,
      sampledAtEat: new Date().toISOString(),
    };
  }
}
