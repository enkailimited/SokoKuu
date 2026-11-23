import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BusinessTier, Prisma } from '@prisma/client';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { ListMerchantsQueryDto, SetMerchantSuspensionDto } from './dto/platform-admin.dto';

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
  accountStatus?: string;
  suspensionReason?: string | null;
  suspendedAt?: string | null;
  suspendedByAdminId?: string | null;
  isPlatformManaged: boolean;
  allowAdminReceive: boolean;
  geospatialMapEnabled: boolean;
  logoCdnUrl: string | null;
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

    const merchants: MerchantDirectoryRecord[] = rows.map((row: any) => ({
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
      accountStatus: row.accountStatus ?? (row.isOpen ? 'ACTIVE' : 'SUSPENDED'),
      suspensionReason: row.suspensionReason ?? null,
      suspendedAt: row.suspendedAt ? new Date(row.suspendedAt).toISOString() : null,
      suspendedByAdminId: row.suspendedByAdminId ?? null,
      isPlatformManaged: row.isPlatformManaged,
      allowAdminReceive: row.allowAdminReceive,
      geospatialMapEnabled: row.geospatialMapEnabled,
      logoCdnUrl: row.logoCdnUrl ?? null,
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

  async setMerchantVerified(
    businessId: string,
    isOpen: boolean,
    adminUserId: string,
  ) {
    return this.prismaService.runInTransaction('RepeatableRead', async (tx) => {
      const existing = await tx.businessProfile.findUnique({
        where: { id: businessId },
        select: { id: true, businessName: true, isOpen: true },
      });

      if (!existing) {
        throw new NotFoundException(`Merchant profile ${businessId} was not found.`);
      }

      const updated = await tx.businessProfile.update({
        where: { id: businessId },
        data: {
          isOpen,
          version: { increment: 1 },
        },
        select: {
          id: true,
          businessName: true,
          isOpen: true,
          updatedAt: true,
        },
      });

      await this.outboxService.enqueue(
        {
          aggregateType: 'BusinessProfile',
          aggregateId: updated.id,
          eventType: 'MerchantVerificationToggledEvent',
          routingKey: 'admin.merchant.verification_toggled',
          payload: {
            merchantId: updated.id,
            merchantName: updated.businessName,
            isOpen: updated.isOpen,
            updatedByAdminId: adminUserId,
          },
        },
        tx,
      );

      this.logger.log(
        `[ADMIN-MERCHANT] merchantId=${updated.id} isOpen=${updated.isOpen}`,
      );

      return {
        merchantId: updated.id,
        merchantName: updated.businessName,
        isOpen: updated.isOpen,
        updatedAtEat: updated.updatedAt.toISOString(),
      };
    });
  }

  async setMerchantSuspension(
    businessId: string,
    dto: SetMerchantSuspensionDto,
    adminUserId: string,
  ) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const existing = await tx.businessProfile.findUnique({
        where: { id: businessId },
        select: {
          id: true,
          businessName: true,
          isOpen: true,
          ownerUserId: true,
          accountStatus: true,
          owner: { select: { id: true, isActive: true } },
        },
      });

      if (!existing) {
        throw new NotFoundException(`Merchant profile ${businessId} was not found.`);
      }

      const suspended = dto.suspended;
      const reason = (dto.reason || '').trim();
      if (suspended && !reason) {
        throw new BadRequestException(
          'Sababu ya kusimamisha akaunti ni lazima / Suspension reason is required.',
        );
      }
      const now = new Date();

      const updatedBusiness = await tx.businessProfile.update({
        where: { id: businessId },
        data: {
          isOpen: !suspended,
          accountStatus: suspended ? 'SUSPENDED' : 'ACTIVE',
          suspensionReason: suspended ? reason : null,
          suspendedAt: suspended ? now : null,
          suspendedByAdminId: suspended ? adminUserId : null,
          version: { increment: 1 },
        } as any,
        select: {
          id: true,
          businessName: true,
          isOpen: true,
          accountStatus: true,
          suspensionReason: true,
          suspendedAt: true,
          suspendedByAdminId: true,
          updatedAt: true,
        } as any,
      });

      await tx.user.update({
        where: { id: existing.ownerUserId },
        data: { isActive: !suspended },
      });

      if (suspended) {
        await tx.refreshSession.updateMany({
          where: { userId: existing.ownerUserId, revokedAt: null },
          data: { revokedAt: now },
        });
      }

      await this.outboxService.enqueue(
        {
          aggregateType: 'BusinessProfile',
          aggregateId: String(updatedBusiness.id),
          eventType: 'MerchantSuspensionToggledEvent',
          routingKey: 'admin.merchant.suspension_toggled',
          payload: {
            merchantId: updatedBusiness.id,
            merchantName: updatedBusiness.businessName,
            ownerUserId: existing.ownerUserId,
            suspended,
            reason: suspended ? reason : null,
            updatedByAdminId: adminUserId,
          } as any,
        },
        tx,
      );

      if (tx.securityAuditLog && typeof tx.securityAuditLog.create === 'function') {
        await tx.securityAuditLog.create({
          data: {
            userId: adminUserId,
            eventType: suspended ? 'MERCHANT_SUSPENDED' : 'MERCHANT_UNSUSPENDED',
            details: {
              merchantId: updatedBusiness.id,
              ownerUserId: existing.ownerUserId,
              reason: suspended ? reason : null,
            } as any,
          },
        });
      }

      this.logger.warn(
        `[ADMIN-MERCHANT-SUSPENSION] merchantId=${updatedBusiness.id} suspended=${suspended} by=${adminUserId}`,
      );

      const ub: any = updatedBusiness;
      return {
        merchantId: ub.id,
        businessId: ub.id,
        businessName: ub.businessName,
        isOpen: ub.isOpen,
        isActive: !suspended,
        suspended,
        accountStatus: ub.accountStatus ?? (suspended ? 'SUSPENDED' : 'ACTIVE'),
        suspensionReason: ub.suspensionReason ?? (suspended ? reason : null),
        suspendedAt: ub.suspendedAt ? new Date(ub.suspendedAt).toISOString() : null,
        suspendedByAdminId: ub.suspendedByAdminId ?? (suspended ? adminUserId : null),
        updatedAtEat: ub.updatedAt.toISOString(),
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

  async getMerchantDossier(businessId: string) {
    const profile = await this.prismaService.businessProfile.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        smsShortCode: true,
        businessName: true,
        tier: true,
        district: true,
        ward: true,
        streetAddress: true,
        latitude: true,
        longitude: true,
        isOpen: true,
        isPlatformManaged: true,
        geospatialMapEnabled: true,
        logoCdnUrl: true,
        wardName: true,
        streetLandmark: true,
        routeWaypoints: true,
        accountStatus: true,
        suspensionReason: true,
        suspendedAt: true,
        suspendedByAdminId: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            id: true,
            fullName: true,
            phoneE164: true,
            preferredLocale: true,
            isActive: true,
          },
        },
      } as any,
    });

    if (!profile) {
      throw new NotFoundException(`Merchant profile ${businessId} was not found.`);
    }

    const p: any = profile;
    const [
      totalSalesAgg,
      ordersCompleted,
      totalOrders,
      activeProductsInStock,
      recentOrders,
      disputes,
      securityAuditLogs,
      financialAuditLogs,
    ] = await Promise.all([
      this.prismaService.order.aggregate({
        where: { sellerBusinessId: businessId, status: 'DELIVERED' as any },
        _sum: { expectedTotalTzs: true },
      }),
      this.prismaService.order.count({
        where: { sellerBusinessId: businessId, status: 'DELIVERED' as any },
      }),
      this.prismaService.order.count({ where: { sellerBusinessId: businessId } }),
      this.prismaService.product.count({
        where: { sellerBusinessId: businessId, isActive: true, baseQuarterQuantaStock: { gt: 0 } },
      }),
      this.prismaService.order.findMany({
        where: { sellerBusinessId: businessId },
        orderBy: { placedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          orderRef: true,
          status: true,
          expectedTotalTzs: true,
          deliveryFeeTzs: true,
          placedAt: true,
          dispatchedAt: true,
          deliveredAt: true,
          buyer: { select: { id: true, fullName: true, phoneE164: true } },
          cashLedger: { select: { verificationStatus: true, collectedCashAmount: true } },
        },
      }),
      this.prismaService.cashDeliveryLedger.findMany({
        where: { order: { sellerBusinessId: businessId }, verificationStatus: 'DISPUTED' as any },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          orderId: true,
          verificationStatus: true,
          expectedCashAmount: true,
          collectedCashAmount: true,
          updatedAt: true,
          order: { select: { orderRef: true, status: true } },
        },
      }),
      this.prismaService.securityAuditLog.findMany({
        where: {
          OR: [
            { userId: p.owner?.id ?? undefined },
            { details: { path: ['merchantId'], equals: businessId } as any },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, eventType: true, details: true, createdAt: true, userId: true },
      }),
      this.prismaService.financialAuditLog.findMany({
        where: { sellerBusinessId: businessId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          eventType: true,
          amountTzs: true,
          previousState: true,
          newState: true,
          details: true,
          createdAt: true,
          orderId: true,
        },
      }),
    ]);

    const totalSalesTzs = Number((totalSalesAgg as any)._sum?.expectedTotalTzs ?? 0n);

    return {
      merchant: {
        merchantId: p.id,
        smsShortCode: p.smsShortCode,
        merchantName: p.businessName,
        tier: p.tier,
        district: p.district,
        ward: p.ward,
        wardName: p.wardName ?? p.ward,
        streetAddress: p.streetAddress,
        streetLandmark: p.streetLandmark ?? p.streetAddress,
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        isOpen: p.isOpen,
        isPlatformManaged: p.isPlatformManaged,
        geospatialMapEnabled: p.geospatialMapEnabled,
        logoCdnUrl: p.logoCdnUrl ?? null,
        routeWaypoints: Array.isArray(p.routeWaypoints) ? p.routeWaypoints : [],
        accountStatus: p.accountStatus ?? (p.isOpen ? 'ACTIVE' : 'SUSPENDED'),
        suspensionReason: p.suspensionReason ?? null,
        suspendedAt: p.suspendedAt ? new Date(p.suspendedAt).toISOString() : null,
        suspendedByAdminId: p.suspendedByAdminId ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      },
      owner: p.owner
        ? {
            userId: p.owner.id,
            fullName: p.owner.fullName,
            phoneE164: p.owner.phoneE164,
            preferredLocale: p.owner.preferredLocale,
            isActive: p.owner.isActive,
          }
        : null,
      activity: {
        totalSalesTzs,
        totalOrders,
        ordersCompleted,
        activeProductsInStock,
      },
      recentOrders: recentOrders.map((o: any) => ({
        orderId: o.id,
        orderRef: o.orderRef,
        status: o.status,
        expectedTotalTzs: Number(o.expectedTotalTzs ?? 0n),
        deliveryFeeTzs: Number(o.deliveryFeeTzs ?? 0n),
        placedAt: o.placedAt?.toISOString?.() ?? null,
        dispatchedAt: o.dispatchedAt?.toISOString?.() ?? null,
        deliveredAt: o.deliveredAt?.toISOString?.() ?? null,
        buyer: o.buyer
          ? { userId: o.buyer.id, fullName: o.buyer.fullName, phoneE164: o.buyer.phoneE164 }
          : null,
        verificationStatus: o.cashLedger?.verificationStatus ?? null,
      })),
      disputeHistory: disputes.map((d: any) => ({
        ledgerId: d.id,
        orderId: d.orderId,
        orderRef: d.order?.orderRef ?? null,
        orderStatus: d.order?.status ?? null,
        verificationStatus: d.verificationStatus,
        discrepancyReason: null,
        expectedAmountTzs: Number(d.expectedCashAmount ?? 0n),
        collectedAmountTzs: Number(d.collectedCashAmount ?? 0n),
        updatedAt: d.updatedAt?.toISOString?.() ?? null,
      })),
      auditHistory: {
        security: securityAuditLogs.map((l: any) => ({
          id: l.id,
          eventType: l.eventType,
          details: l.details,
          createdAt: l.createdAt?.toISOString?.() ?? null,
          userId: l.userId ?? null,
        })),
        financial: financialAuditLogs.map((l: any) => ({
          id: l.id,
          eventType: l.eventType,
          amountTzs: l.amountTzs != null ? Number(l.amountTzs) : null,
          previousState: l.previousState ?? null,
          newState: l.newState ?? null,
          details: l.details,
          createdAt: l.createdAt?.toISOString?.() ?? null,
          orderId: l.orderId ?? null,
        })),
      },
    };
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
