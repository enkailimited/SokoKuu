import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantContext } from '@common/security/auth.types';
import { PrismaService } from '@database/prisma.service';
import { ListManagedOrdersQueryDto, UpdateManagedOrderStatusDto } from './dto/audit.dto';

@Injectable()
export class AuditService {
  constructor(private readonly prismaService: PrismaService) {}

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
          },
        },
        seller: {
          select: {
            id: true,
            businessName: true,
            smsShortCode: true,
            isPlatformManaged: true,
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
        isPlatformManagedSnapshot: trace.isPlatformManagedSnapshot,
        routingOutputCode: trace.routingOutputCode,
        targetPipeline: trace.targetPipeline,
        txIsolationLevel: trace.txIsolationLevel,
        helpdeskStatus: trace.helpdeskStatus,
        handledNotes: trace.handledNotes,
        handledAt: trace.handledAt?.toISOString() ?? null,
        recordedAt: trace.recordedAt.toISOString(),
        orderStatus: trace.order.status,
        expectedTotalTzs: Number(trace.order.expectedTotalTzs),
      })),
    };
  }

  async updateManagedOrderHelpdeskStatus(
    traceId: string,
    dto: UpdateManagedOrderStatusDto,
    adminUserId: string,
  ) {
    return this.prismaService.runInTransaction('RepeatableRead', async (tx) => {
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
}
