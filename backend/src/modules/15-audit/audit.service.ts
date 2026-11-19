import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { Role } from '@common/security/roles.enum';
import { PrismaService } from '@database/prisma.service';
import { DispatchService } from '@modules/12-dispatch/dispatch.service';
import { ListManagedOrdersQueryDto, UpdateManagedOrderStatusDto } from './dto/audit.dto';
import { RetentionCronService } from './retention-cron.service';

@Injectable()
export class AuditService {
  constructor(
    private readonly prismaService: PrismaService,
    @Optional() private readonly retentionCronService?: RetentionCronService,
    @Optional() private readonly dispatchService?: DispatchService,
  ) {}

  async listManagedOrders(query: ListManagedOrdersQueryDto) {
    const traces = await this.prismaService.orderDispatchAuditTrace.findMany({
      where: {
        ...(query.routingOutputCode ? { routingOutputCode: query.routingOutputCode } : {}),
        ...(query.helpdeskStatus ? { helpdeskStatus: query.helpdeskStatus } : {}),
        ...(query.sellerBusinessId ? { sellerBusinessId: query.sellerBusinessId } : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take: 100,
      include: {
        order: {
          select: {
            id: true,
            orderRef: true,
            status: true,
            expectedTotalTzs: true,
            paymentMethod: true,
            placedAt: true,
            dispatchedAt: true,
            deliveredAt: true,
            buyer: {
              select: {
                fullName: true,
                phoneE164: true,
              },
            },
            driver: {
              select: {
                id: true,
                fullName: true,
                phoneE164: true,
              },
            },
          },
        },
        seller: {
          select: {
            id: true,
            businessName: true,
            smsShortCode: true,
            isPlatformManaged: true,
            allowAdminReceive: true,
            tier: true,
            owner: {
              select: {
                fullName: true,
                phoneE164: true,
              },
            },
          },
        },
      },
    });

    return {
      count: traces.length,
      traces: traces.map((trace) => ({
        traceId: trace.id,
        orderId: trace.orderId,
        orderRef8: trace.orderRef8,
        sellerBusinessId: trace.sellerBusinessId,
        merchantName: trace.seller.businessName,
        merchantShortCode: trace.seller.smsShortCode,
        sellerOwnerName: trace.seller.owner.fullName,
        sellerPhoneE164: trace.seller.owner.phoneE164,
        buyerName: trace.order.buyer.fullName,
        buyerPhoneE164: trace.order.buyer.phoneE164,
        driverName: trace.order.driver?.fullName ?? null,
        driverPhoneE164: trace.order.driver?.phoneE164 ?? null,
        isPlatformManagedSnapshot: trace.isPlatformManagedSnapshot,
        sellerTier: trace.seller.tier,
        sellerAllowAdminReceive: trace.seller.allowAdminReceive,
        routingOutputCode: trace.routingOutputCode,
        targetPipeline: trace.targetPipeline,
        txIsolationLevel: trace.txIsolationLevel,
        helpdeskStatus: trace.helpdeskStatus,
        handledNotes: trace.handledNotes,
        handledAt: trace.handledAt?.toISOString() ?? null,
        recordedAt: trace.recordedAt.toISOString(),
        orderStatus: trace.order.status,
        expectedTotalTzs: Number(trace.order.expectedTotalTzs),
        dispatchedAt: trace.order.dispatchedAt?.toISOString() ?? null,
        deliveredAt: trace.order.deliveredAt?.toISOString() ?? null,
      })),
    };
  }

  async listActiveDrivers() {
    const drivers = await this.prismaService.user.findMany({
      where: { role: UserRole.DRIVER, isActive: true },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, phoneE164: true },
    });

    return {
      count: drivers.length,
      drivers: drivers.map((driver) => ({
        driverId: driver.id,
        driverName: driver.fullName,
        phoneE164: driver.phoneE164,
      })),
    };
  }

  async updateManagedOrderHelpdeskStatus(
    traceId: string,
    dto: UpdateManagedOrderStatusDto,
    adminUserId: string,
  ) {
    let dispatchResult: Awaited<
      ReturnType<DispatchService['dispatchOrderAndAllocatePins']>
    > | null = null;

    if (dto.helpdeskStatus === 'IN_TRANSIT') {
      const trace = await this.prismaService.orderDispatchAuditTrace.findUnique({
        where: { id: traceId },
        select: { id: true, orderId: true },
      });

      if (!trace) {
        throw new NotFoundException(`Order dispatch audit trace ${traceId} was not found.`);
      }

      if (!trace.orderId) {
        throw new ConflictException(
          `Order dispatch audit trace ${traceId} is not linked to a live order.`,
        );
      }

      const order = await this.prismaService.order.findUnique({
        where: { id: trace.orderId },
        select: { id: true, status: true },
      });

      if (!order) {
        throw new NotFoundException(`Order ${trace.orderId} was not found.`);
      }

      if (order.status === 'PLACED') {
        if (!this.dispatchService) {
          throw new ConflictException(
            'Dispatch service is unavailable; cannot start order transit.',
          );
        }

        dispatchResult = await this.dispatchService.dispatchOrderAndAllocatePins(
          trace.orderId,
          { driverUserId: dto.driverUserId },
          { sub: adminUserId, role: Role.SUPER_ADMIN },
        );
      } else if (order.status !== 'DISPATCHED') {
        throw new ConflictException(
          `Order ${trace.orderId} cannot start transit from ${order.status}.`,
        );
      }
    }

    const result = await this.prismaService.runInTransaction('RepeatableRead', async (tx) => {
      const trace = await tx.orderDispatchAuditTrace.findUnique({
        where: { id: traceId },
      });

      if (!trace) {
        throw new NotFoundException(`Order dispatch audit trace ${traceId} was not found.`);
      }

      const previousStatus = trace.helpdeskStatus;
      const updated = await tx.orderDispatchAuditTrace.update({
        where: { id: traceId },
        data: {
          helpdeskStatus: dto.helpdeskStatus,
          handledByAdminId: adminUserId,
          handledNotes: dto.notes?.trim() ?? trace.handledNotes,
          handledAt: new Date(),
        },
      });

      await tx.securityAuditLog.create({
        data: {
          userId: adminUserId,
          eventType: 'MANAGED_HELPDESK_STATUS_UPDATED',
          details: {
            traceId,
            orderId: trace.orderId,
            previousStatus,
            newStatus: dto.helpdeskStatus,
            notes: dto.notes?.trim() ?? null,
          },
        },
      });

      return {
        traceId: updated.id,
        orderId: updated.orderId,
        previousStatus,
        helpdeskStatus: updated.helpdeskStatus,
        handledByAdminId: updated.handledByAdminId,
        handledNotes: updated.handledNotes,
        handledAt: updated.handledAt?.toISOString() ?? null,
      };
    });

    return {
      ...result,
      orderStatus: dispatchResult?.status ?? null,
      driverUserId: dispatchResult?.driverUserId ?? null,
      ledgerId: dispatchResult?.ledgerId ?? null,
      buyerConfirmationPin: dispatchResult?.buyerConfirmationPin ?? null,
      driverConfirmationPin: dispatchResult?.driverConfirmationPin ?? null,
      dispatchedAtEat: dispatchResult?.dispatchedAtEat ?? null,
    };
  }

  async listFinancialAuditLogs(
    tenantContext?: TenantContext,
    sellerBusinessIdParam?: string,
  ) {
    const resolvedBusinessId = tenantContext?.isSuperAdmin
      ? sellerBusinessIdParam ?? undefined
      : tenantContext?.businessId;

    if (!tenantContext?.isSuperAdmin && !resolvedBusinessId) {
      throw new ForbiddenException('Authenticated Merchant context required for audit logs.');
    }

    if (
      !tenantContext?.isSuperAdmin &&
      sellerBusinessIdParam &&
      sellerBusinessIdParam !== resolvedBusinessId
    ) {
      throw new ForbiddenException('Cross-Merchant audit log access denied.');
    }

    const logs = await this.prismaService.financialAuditLog.findMany({
      where: resolvedBusinessId ? { sellerBusinessId: resolvedBusinessId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      count: logs.length,
      logs: logs.map((log) => ({
        id: log.id,
        actorUserId: log.actorUserId,
        sellerBusinessId: log.sellerBusinessId,
        orderId: log.orderId,
        settlementBatchId: log.settlementBatchId,
        eventType: log.eventType,
        amountTzs: Number(log.amountTzs),
        previousState: log.previousState,
        newState: log.newState,
        details: log.details,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  async listFraudAlerts() {
    const [securityLogs, disputedLedgers] = await Promise.all([
      this.prismaService.securityAuditLog.findMany({
        where: {
          eventType: {
            in: [
              'DRIVER_3_STRIKE_AUDIT_FLAGGED',
              'REFRESH_TOKEN_REUSE_DETECTED',
              'LOGIN_BRUTE_FORCE_LOCKOUT',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          user: {
            select: { id: true, fullName: true, phoneE164: true, role: true },
          },
        },
      }),
      this.prismaService.cashDeliveryLedger.findMany({
        where: { verificationStatus: 'DISPUTED' },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        include: {
          order: { select: { orderRef: true } },
          driver: { select: { id: true, fullName: true, phoneE164: true } },
        },
      }),
    ]);

    return {
      securityAlerts: securityLogs.map((log) => ({
        id: log.id,
        eventType: log.eventType,
        severity:
          log.eventType === 'DRIVER_3_STRIKE_AUDIT_FLAGGED' ||
          log.eventType === 'REFRESH_TOKEN_REUSE_DETECTED'
            ? ('CRITICAL_3_STRIKE' as const)
            : ('INFO' as const),
        userId: log.userId,
        actorName: log.user?.fullName ?? null,
        actorPhone: log.user?.phoneE164 ?? null,
        details: log.details,
        createdAt: log.createdAt.toISOString(),
      })),
      disputedLedgers: disputedLedgers.map((l) => ({
        ledgerId: l.id,
        orderId: l.orderId,
        orderRef: l.order.orderRef,
        driverUserId: l.driverUserId,
        driverName: l.driver?.fullName ?? 'Unassigned',
        expectedCashTzs: Number(l.expectedCashAmount),
        collectedCashTzs: Number(l.collectedCashAmount),
        varianceTzs: Number(l.expectedCashAmount) - Number(l.collectedCashAmount),
        updatedAt: l.updatedAt.toISOString(),
      })),
    };
  }

  async getRetentionStats() {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [
      totalIdempotencyKeys,
      staleIdempotencyKeysCount,
      totalActiveLedgers,
      archiveEligibleLedgersCount,
      disputedLedgersCount,
      coldArchiveLedgersCount,
      pendingOutboxCount,
      deadLetterOutboxCount,
    ] = await Promise.all([
      this.prismaService.idempotencyKey.count(),
      this.prismaService.idempotencyKey.count({
        where: { expiresAt: { lte: fortyEightHoursAgo } },
      }),
      this.prismaService.cashDeliveryLedger.count(),
      this.prismaService.cashDeliveryLedger.count({
        where: {
          verificationStatus: 'SUCCESSFUL',
          reconciledAt: { lte: ninetyDaysAgo },
        },
      }),
      this.prismaService.cashDeliveryLedger.count({
        where: { verificationStatus: 'DISPUTED' },
      }),
      this.prismaService.cashDeliveryLedgerArchive.count(),
      this.prismaService.domainOutboxEvent.count({
        where: { status: 'PENDING' },
      }),
      this.prismaService.domainOutboxEvent.count({
        where: { status: 'DEAD_LETTER' },
      }),
    ]);

    return {
      totalIdempotencyKeys,
      staleIdempotencyKeysCount,
      totalActiveLedgers,
      archiveEligibleLedgersCount,
      disputedLedgersCount,
      coldArchiveLedgersCount,
      pendingOutboxCount,
      deadLetterOutboxCount,
      sampledAt: new Date().toISOString(),
    };
  }

  async runRetentionCleanupNow() {
    if (this.retentionCronService) {
      return this.retentionCronService.runRetentionMaintenance();
    }
    return { purgedKeys: 0, archivedLedgers: 0 };
  }
}
