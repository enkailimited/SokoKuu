import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { sanitizeCsvCell, UTF8_BOM } from './csv-formula.util';
import {
  RecordLedgerPaymentDto,
  SettleDriverEodDto,
  VerifyMobileMoneyDto,
} from './dto/financials.dto';

interface LockedEodLedgerRow {
  ledger_id: string;
  order_id: string;
  order_ref: string;
  order_status: string;
  origin_channel: string;
  expected_cash_amount: bigint;
  collected_cash_amount: bigint;
  payment_method: string;
  mobile_money_ref: string | null;
  mobile_money_verified: boolean;
  verification_status: string;
}

interface LockedEodPosRow {
  id: string;
  receipt_id: string;
  payment_method: string;
  total_tzs: bigint;
  collected_amount_tzs: bigint;
  payment_verified: boolean;
}

@Injectable()
export class FinancialsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  private resolveAuthorizedBusinessId(
    tenantContext: TenantContext | undefined,
    requestedBusinessId?: string,
  ): string {
    if (tenantContext?.isSuperAdmin) {
      const target = requestedBusinessId ?? tenantContext.businessId;
      if (!target) {
        throw new ForbiddenException('businessId is required for SUPER_ADMIN analytics query.');
      }
      return target;
    }

    if (!tenantContext?.businessId) {
      throw new ForbiddenException('Authenticated Merchant tenant context is required.');
    }

    if (requestedBusinessId && requestedBusinessId !== tenantContext.businessId) {
      throw new ForbiddenException(
        'Cross-Merchant financial access denied: businessId override blocked.',
      );
    }

    return tenantContext.businessId;
  }

  async recordPartialOrFullPayment(
    orderId: string,
    dto: RecordLedgerPaymentDto,
    user: AuthenticatedUser,
    tenantContext?: TenantContext,
  ) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          order_id: string;
          seller_business_id: string;
          driver_user_id: string | null;
          expected_cash_amount: bigint;
          collected_cash_amount: bigint;
          eod_settled_at: Date | null;
        }>
      >`
        SELECT l.id::text AS id,
               l.order_id::text AS order_id,
               o.seller_business_id::text AS seller_business_id,
               o.driver_user_id::text AS driver_user_id,
               l.expected_cash_amount,
               l.collected_cash_amount,
               l.eod_settled_at
          FROM cash_delivery_ledgers l
          JOIN orders o ON o.id = l.order_id
         WHERE l.order_id = ${orderId}::uuid
           FOR UPDATE
      `;

      const row = rows[0];
      if (!row) {
        throw new NotFoundException(`Cash delivery ledger for order ${orderId} was not found.`);
      }

      const isAuthorized =
        tenantContext?.isSuperAdmin ||
        row.seller_business_id === tenantContext?.businessId ||
        row.driver_user_id === user.sub;
      if (!isAuthorized) {
        throw new ForbiddenException('Not authorized to record payment on this ledger.');
      }

      if (row.eod_settled_at) {
        throw new ConflictException('Ledger has already been closed in an EOD settlement batch.');
      }

      const expected = BigInt(row.expected_cash_amount);
      const collected = BigInt(dto.collectedAmountTzs);
      if (collected > expected) {
        throw new ConflictException(
          `Collected amount (${collected}) cannot exceed expected amount (${expected}).`,
        );
      }

      const isCash = dto.paymentMethod === 'CASH';
      const verified = isCash ? true : Boolean(dto.mobileMoneyVerified);
      const outstanding = expected - collected;

      await tx.$executeRaw`
        UPDATE cash_delivery_ledgers
           SET collected_cash_amount = ${collected},
               payment_method = ${dto.paymentMethod},
               mobile_money_ref = ${dto.mobileMoneyRef ?? null},
               mobile_money_verified = ${verified},
               version = version + 1,
               updated_at = NOW()
         WHERE id = ${row.id}::uuid
      `;

      await tx.$executeRaw`
        UPDATE orders
           SET payment_method = ${dto.paymentMethod},
               paid_amount_tzs = ${collected},
               version = version + 1
         WHERE id = ${orderId}::uuid
      `;

      if (tx.financialAuditLog && typeof tx.financialAuditLog.create === 'function') {
        await tx.financialAuditLog.create({
          data: {
            actorUserId: user.sub,
            sellerBusinessId: row.seller_business_id,
            orderId,
            eventType: outstanding > 0n ? 'PARTIAL_PAYMENT_RECORDED' : 'FULL_PAYMENT_RECORDED',
            amountTzs: collected,
            previousState: String(row.collected_cash_amount),
            newState: String(collected),
            details: {
              paymentMethod: dto.paymentMethod,
              mobileMoneyRef: dto.mobileMoneyRef ?? null,
              mobileMoneyVerified: verified,
              expectedAmountTzs: Number(expected),
              collectedAmountTzs: Number(collected),
              outstandingBalanceTzs: Number(outstanding),
            },
          },
        });
      }

      return {
        orderId,
        expectedAmountTzs: Number(expected),
        collectedAmountTzs: Number(collected),
        outstandingBalanceTzs: Number(outstanding),
        paymentMethod: dto.paymentMethod,
        mobileMoneyVerified: verified,
        isPartialPayment: outstanding > 0n,
      };
    });
  }

  async verifyMobileMoneyLedger(
    orderId: string,
    dto: VerifyMobileMoneyDto,
    user: AuthenticatedUser,
    tenantContext?: TenantContext,
  ) {
    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          seller_business_id: string;
          collected_cash_amount: bigint;
          payment_method: string;
          mobile_money_verified: boolean;
        }>
      >`
        SELECT l.id::text AS id,
               o.seller_business_id::text AS seller_business_id,
               l.collected_cash_amount,
               l.payment_method,
               l.mobile_money_verified
          FROM cash_delivery_ledgers l
          JOIN orders o ON o.id = l.order_id
         WHERE l.order_id = ${orderId}::uuid
           FOR UPDATE
      `;

      const row = rows[0];
      if (!row) {
        throw new NotFoundException(`Cash delivery ledger for order ${orderId} was not found.`);
      }

      if (!tenantContext?.isSuperAdmin && row.seller_business_id !== tenantContext?.businessId) {
        throw new ForbiddenException('Cross-Merchant mobile money verification denied.');
      }

      await tx.$executeRaw`
        UPDATE cash_delivery_ledgers
           SET mobile_money_ref = ${dto.mobileMoneyRef.trim()},
               mobile_money_verified = ${dto.verified},
               version = version + 1,
               updated_at = NOW()
         WHERE id = ${row.id}::uuid
      `;

      if (tx.financialAuditLog && typeof tx.financialAuditLog.create === 'function') {
        await tx.financialAuditLog.create({
          data: {
            actorUserId: user.sub,
            sellerBusinessId: row.seller_business_id,
            orderId,
            eventType: 'MOBILE_MONEY_VERIFICATION_UPDATED',
            amountTzs: BigInt(row.collected_cash_amount),
            previousState: String(row.mobile_money_verified),
            newState: String(dto.verified),
            details: {
              paymentMethod: row.payment_method,
              mobileMoneyRef: dto.mobileMoneyRef.trim(),
              verified: dto.verified,
            },
          },
        });
      }

      return {
        orderId,
        mobileMoneyRef: dto.mobileMoneyRef.trim(),
        mobileMoneyVerified: dto.verified,
      };
    });
  }

  async listDriversForEod(tenantContext?: TenantContext, requestedBusinessId?: string) {
    const sellerBusinessId = this.resolveAuthorizedBusinessId(tenantContext, requestedBusinessId);

    const ledgers = await this.prismaService.cashDeliveryLedger.findMany({
      where: {
        eodSettledAt: null,
        driverUserId: { not: null },
        order: { sellerBusinessId },
      },
      include: {
        driver: { select: { id: true, fullName: true, phoneE164: true } },
        order: { select: { id: true, status: true, originChannel: true } },
      },
    });

    const summaryByDriver = new Map<
      string,
      {
        driverId: string;
        driverName: string;
        phoneE164: string;
        unsettledOrdersCount: number;
        expectedTotalTzs: number;
        collectedTotalTzs: number;
        outstandingBalanceTzs: number;
        cashTotalTzs: number;
        mpesaTotalTzs: number;
        tigoPesaTotalTzs: number;
        disputedOrPendingCount: number;
        unverifiedMobileMoneyCount: number;
      }
    >();

    for (const l of ledgers) {
      if (!l.driverUserId || !l.driver) continue;
      let entry = summaryByDriver.get(l.driverUserId);
      if (!entry) {
        entry = {
          driverId: l.driverUserId,
          driverName: l.driver.fullName,
          phoneE164: l.driver.phoneE164,
          unsettledOrdersCount: 0,
          expectedTotalTzs: 0,
          collectedTotalTzs: 0,
          outstandingBalanceTzs: 0,
          cashTotalTzs: 0,
          mpesaTotalTzs: 0,
          tigoPesaTotalTzs: 0,
          disputedOrPendingCount: 0,
          unverifiedMobileMoneyCount: 0,
        };
        summaryByDriver.set(l.driverUserId, entry);
      }

      const expected = Number(l.expectedCashAmount);
      const collected = Number(l.collectedCashAmount);
      entry.unsettledOrdersCount += 1;
      entry.expectedTotalTzs += expected;
      entry.collectedTotalTzs += collected;
      entry.outstandingBalanceTzs += Math.max(0, expected - collected);

      if (l.paymentMethod === 'CASH') entry.cashTotalTzs += collected;
      else if (l.paymentMethod === 'M-PESA') entry.mpesaTotalTzs += collected;
      else if (l.paymentMethod === 'TIGO-PESA') entry.tigoPesaTotalTzs += collected;

      if (
        l.verificationStatus !== 'SUCCESSFUL' ||
        l.order.status === 'DISPUTED'
      ) {
        entry.disputedOrPendingCount += 1;
      }
      if (l.paymentMethod !== 'CASH' && !l.mobileMoneyVerified) {
        entry.unverifiedMobileMoneyCount += 1;
      }
    }

    const drivers = Array.from(summaryByDriver.values());
    return {
      sellerBusinessId,
      count: drivers.length,
      drivers,
    };
  }

  async settleDriverEod(
    driverId: string,
    dto: SettleDriverEodDto,
    user: AuthenticatedUser,
    tenantContext?: TenantContext,
  ) {
    const sellerBusinessId = this.resolveAuthorizedBusinessId(tenantContext);

    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const lockedLedgers = await tx.$queryRaw<LockedEodLedgerRow[]>`
        SELECT l.id::text AS ledger_id,
               o.id::text AS order_id,
               o.order_ref,
               o.status AS order_status,
               o.origin_channel,
               l.expected_cash_amount,
               l.collected_cash_amount,
               l.payment_method,
               l.mobile_money_ref,
               l.mobile_money_verified,
               l.verification_status
          FROM cash_delivery_ledgers l
          JOIN orders o ON o.id = l.order_id
         WHERE o.seller_business_id = ${sellerBusinessId}::uuid
           AND l.driver_user_id = ${driverId}::uuid
           AND l.eod_settled_at IS NULL
           FOR UPDATE
      `;

      const lockedPosRows = await tx.$queryRaw<LockedEodPosRow[]>`
        SELECT id::text AS id,
               receipt_id,
               payment_method,
               total_tzs,
               collected_amount_tzs,
               payment_verified
          FROM pos_sales_receipts
         WHERE seller_business_id = ${sellerBusinessId}::uuid
           AND eod_settlement_batch_id IS NULL
           FOR UPDATE
      `;

      if (lockedLedgers.length === 0 && lockedPosRows.length === 0) {
        throw new ConflictException(
          'EOD_ALREADY_SETTLED_OR_EMPTY: No unsettled driver deliveries or POS receipts found.',
        );
      }

      // Gate 1: Reject open DISPUTED or unresolved WAITING/PENDING items
      const blockingExceptions = lockedLedgers.filter(
        (l) =>
          l.verification_status === 'DISPUTED' ||
          l.verification_status === 'PENDING' ||
          l.verification_status === 'WAITING' ||
          l.order_status === 'DISPUTED',
      );
      if (blockingExceptions.length > 0) {
        throw new ConflictException(
          `EOD_BLOCKED_UNRESOLVED_EXCEPTIONS: ${blockingExceptions.length} unresolved or DISPUTED deliveries must be cleared before EOD settlement.`,
        );
      }

      // Gate 2: Reject delivered-without-confirmation or unverified mobile money
      const unconfirmedPayment = lockedLedgers.filter(
        (l) => l.verification_status !== 'SUCCESSFUL' || l.order_status !== 'DELIVERED',
      );
      if (unconfirmedPayment.length > 0) {
        throw new ConflictException(
          'EOD_BLOCKED_PAYMENT_NOT_CONFIRMED: Order delivery status alone does not confirm payment.',
        );
      }

      const unverifiedMobileLedgers = lockedLedgers.filter(
        (l) => l.payment_method !== 'CASH' && (!l.mobile_money_verified || !l.mobile_money_ref),
      );
      const unverifiedMobilePos = lockedPosRows.filter(
        (p) => p.payment_method !== 'CASH' && !p.payment_verified,
      );
      if (unverifiedMobileLedgers.length > 0 || unverifiedMobilePos.length > 0) {
        throw new ConflictException(
          `EOD_BLOCKED_UNVERIFIED_MOBILE_MONEY: ${
            unverifiedMobileLedgers.length + unverifiedMobilePos.length
          } mobile money transaction(s) await verification before EOD settlement.`,
        );
      }

      let expectedTotalTzs = 0n;
      let collectedTotalTzs = 0n;
      let cashTotalTzs = 0n;
      let mpesaTotalTzs = 0n;
      let tigoPesaTotalTzs = 0n;
      let posSalesTotalTzs = 0n;

      for (const l of lockedLedgers) {
        const exp = BigInt(l.expected_cash_amount);
        const col = BigInt(l.collected_cash_amount);
        expectedTotalTzs += exp;
        collectedTotalTzs += col;
        if (l.payment_method === 'CASH') cashTotalTzs += col;
        else if (l.payment_method === 'M-PESA') mpesaTotalTzs += col;
        else if (l.payment_method === 'TIGO-PESA') tigoPesaTotalTzs += col;
      }

      for (const p of lockedPosRows) {
        const exp = BigInt(p.total_tzs);
        const col = BigInt(p.collected_amount_tzs);
        expectedTotalTzs += exp;
        collectedTotalTzs += col;
        posSalesTotalTzs += col;
        if (p.payment_method === 'CASH') cashTotalTzs += col;
        else if (p.payment_method === 'M-PESA') mpesaTotalTzs += col;
        else if (p.payment_method === 'TIGO-PESA') tigoPesaTotalTzs += col;
      }

      const outstandingBalanceTzs =
        expectedTotalTzs > collectedTotalTzs ? expectedTotalTzs - collectedTotalTzs : 0n;

      if (outstandingBalanceTzs > 0n && !dto.acknowledgeOutstandingBalance) {
        throw new ConflictException(
          `EOD_BLOCKED_OUTSTANDING_BALANCE: Unpaid partial balance of ${outstandingBalanceTzs.toString()} TZS requires explicit acknowledgement.`,
        );
      }

      const declaredCash = BigInt(dto.declaredCashTzs);
      const varianceTzs = declaredCash - cashTotalTzs;
      if (varianceTzs !== 0n) {
        throw new ConflictException(
          `EOD_CASH_VARIANCE_MISMATCH: Declared cash ${declaredCash.toString()} TZS does not match ledger cash ${cashTotalTzs.toString()} TZS (variance=${varianceTzs.toString()}).`,
        );
      }

      const batch = await tx.eodSettlementBatch.create({
        data: {
          sellerBusinessId,
          driverUserId: driverId,
          settledByUserId: user.sub,
          settledOrdersCount: lockedLedgers.length,
          expectedTotalTzs,
          collectedTotalTzs,
          outstandingBalanceTzs,
          varianceTzs,
          cashTotalTzs,
          mpesaTotalTzs,
          tigoPesaTotalTzs,
          posSalesTotalTzs,
          notes: dto.notes?.trim() ?? null,
        },
        select: { id: true, createdAt: true },
      });

      const ledgerIds = lockedLedgers.map((l) => l.ledger_id);
      if (ledgerIds.length > 0) {
        await tx.$executeRaw`
          UPDATE cash_delivery_ledgers
             SET eod_settled_at = NOW(),
                 eod_settlement_batch_id = ${batch.id}::uuid,
                 version = version + 1,
                 updated_at = NOW()
           WHERE id = ANY(${ledgerIds}::uuid[])
        `;
      }

      const posIds = lockedPosRows.map((p) => p.id);
      if (posIds.length > 0) {
        await tx.$executeRaw`
          UPDATE pos_sales_receipts
             SET eod_settlement_batch_id = ${batch.id}::uuid
           WHERE id = ANY(${posIds}::uuid[])
        `;
      }

      if (tx.financialAuditLog && typeof tx.financialAuditLog.create === 'function') {
        await tx.financialAuditLog.create({
          data: {
            actorUserId: user.sub,
            sellerBusinessId,
            settlementBatchId: batch.id,
            eventType: 'EOD_DRIVER_SETTLED',
            amountTzs: collectedTotalTzs,
            previousState: 'UNSETTLED',
            newState: outstandingBalanceTzs > 0n ? 'SETTLED_WITH_OUTSTANDING' : 'SETTLED_BALANCED',
            details: {
              driverId,
              settledOrdersCount: lockedLedgers.length,
              posReceiptsCount: lockedPosRows.length,
              expectedTotalTzs: Number(expectedTotalTzs),
              collectedTotalTzs: Number(collectedTotalTzs),
              outstandingBalanceTzs: Number(outstandingBalanceTzs),
              cashTotalTzs: Number(cashTotalTzs),
              mpesaTotalTzs: Number(mpesaTotalTzs),
              tigoPesaTotalTzs: Number(tigoPesaTotalTzs),
            },
          },
        });
      }

      await this.outboxService.enqueue(
        {
          aggregateType: 'EodSettlementBatch',
          aggregateId: batch.id,
          eventType: 'EodReconciliationSettledEvent',
          routingKey: 'financials.eod.settled',
          payload: {
            batchId: batch.id,
            sellerBusinessId,
            driverId,
            settledOrdersCount: lockedLedgers.length,
            collectedTotalTzs: Number(collectedTotalTzs),
            outstandingBalanceTzs: Number(outstandingBalanceTzs),
          },
        },
        tx,
      );

      return {
        batchId: batch.id,
        sellerBusinessId,
        driverId,
        settledOrdersCount: lockedLedgers.length,
        posReceiptsCount: lockedPosRows.length,
        expectedTotalTzs: Number(expectedTotalTzs),
        collectedTotalTzs: Number(collectedTotalTzs),
        outstandingBalanceTzs: Number(outstandingBalanceTzs),
        varianceTzs: Number(varianceTzs),
        breakdown: {
          cashTotalTzs: Number(cashTotalTzs),
          mpesaTotalTzs: Number(mpesaTotalTzs),
          tigoPesaTotalTzs: Number(tigoPesaTotalTzs),
          posSalesTotalTzs: Number(posSalesTotalTzs),
        },
        settledAtEat: batch.createdAt.toISOString(),
      };
    });
  }

  async getDailyRevenueAnalytics(
    businessIdParam: string,
    tenantContext?: TenantContext,
  ) {
    const sellerBusinessId = this.resolveAuthorizedBusinessId(tenantContext, businessIdParam);

    const orders = await this.prismaService.order.findMany({
      where: {
        sellerBusinessId,
        status: 'DELIVERED',
      },
      include: {
        items: { select: { isWholesaleTierApplied: true, lineTotalTzs: true } },
        cashLedger: {
          select: {
            collectedCashAmount: true,
            paymentMethod: true,
            verificationStatus: true,
          },
        },
      },
    });

    const posReceipts = await this.prismaService.posSaleReceipt.findMany({
      where: { sellerBusinessId },
    });

    let b2bWholesaleRevenueTzs = 0;
    let b2cRetailRevenueTzs = 0;
    let totalCollectedTzs = 0;
    let totalOutstandingTzs = 0;
    const byPaymentMethod = { CASH: 0, 'M-PESA': 0, 'TIGO-PESA': 0 };

    for (const order of orders) {
      const expected = Number(order.expectedTotalTzs);
      const collected = Number(order.cashLedger?.collectedCashAmount ?? order.paidAmountTzs);
      totalCollectedTzs += collected;
      totalOutstandingTzs += Math.max(0, expected - collected);

      const hasWholesaleItems = order.items.some((i) => i.isWholesaleTierApplied);
      if (hasWholesaleItems) b2bWholesaleRevenueTzs += collected;
      else b2cRetailRevenueTzs += collected;

      const pm = (order.cashLedger?.paymentMethod ?? order.paymentMethod) as keyof typeof byPaymentMethod;
      if (pm in byPaymentMethod) {
        byPaymentMethod[pm] += collected;
      }
    }

    let posWalkinRevenueTzs = 0;
    for (const pos of posReceipts) {
      const col = Number(pos.collectedAmountTzs);
      posWalkinRevenueTzs += col;
      totalCollectedTzs += col;
      b2cRetailRevenueTzs += col;
      const pm = pos.paymentMethod as keyof typeof byPaymentMethod;
      if (pm in byPaymentMethod) {
        byPaymentMethod[pm] += col;
      }
    }

    return {
      sellerBusinessId,
      currency: 'TZS',
      deliveredOrdersCount: orders.length,
      posReceiptsCount: posReceipts.length,
      b2bWholesaleRevenueTzs,
      b2cRetailRevenueTzs,
      posWalkinRevenueTzs,
      totalCollectedTzs,
      totalOutstandingTzs,
      byPaymentMethod,
      generatedAtEat: new Date().toISOString(),
    };
  }

  async generateSwahiliAnalyticsCsv(
    tenantContext?: TenantContext,
    requestedBusinessId?: string,
  ): Promise<string> {
    const sellerBusinessId = this.resolveAuthorizedBusinessId(
      tenantContext,
      requestedBusinessId,
    );

    const orders = await this.prismaService.order.findMany({
      where: { sellerBusinessId },
      orderBy: { placedAt: 'desc' },
      take: 500,
      include: {
        buyer: { select: { fullName: true } },
        cashLedger: {
          select: {
            collectedCashAmount: true,
            paymentMethod: true,
            verificationStatus: true,
          },
        },
      },
    });

    const posReceipts = await this.prismaService.posSaleReceipt.findMany({
      where: { sellerBusinessId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const headers = [
      'Kumbukumbu',
      'Tarehe (EAT)',
      'Aina ya Mauzo',
      'Hali ya Oda',
      'Njia ya Malipo',
      'Jumla Tarajiwa (TZS)',
      'Kiasi Kilichokusanywa (TZS)',
      'Salio Baki (TZS)',
      'Hali ya Malipo',
      'Jina la Mteja',
    ];

    const lines: string[] = [headers.map((h) => sanitizeCsvCell(h)).join(',')];

    for (const order of orders) {
      const expected = Number(order.expectedTotalTzs);
      const collected = Number(order.cashLedger?.collectedCashAmount ?? order.paidAmountTzs);
      const outstanding = Math.max(0, expected - collected);
      const row = [
        order.orderRef,
        order.placedAt.toISOString(),
        'ODA YA SOKOKUU',
        order.status,
        order.cashLedger?.paymentMethod ?? order.paymentMethod,
        expected,
        collected,
        outstanding,
        order.cashLedger?.verificationStatus ?? 'PENDING',
        order.buyer?.fullName ?? 'Mteja',
      ];
      lines.push(row.map((cell) => sanitizeCsvCell(cell)).join(','));
    }

    for (const pos of posReceipts) {
      const expected = Number(pos.totalTzs);
      const collected = Number(pos.collectedAmountTzs);
      const outstanding = Math.max(0, expected - collected);
      const row = [
        pos.receiptId,
        pos.createdAt.toISOString(),
        'MAUZO YA DUKA (POS)',
        'DELIVERED',
        pos.paymentMethod,
        expected,
        collected,
        outstanding,
        pos.paymentVerified ? 'VERIFIED' : 'UNVERIFIED',
        'Mteja wa Dukani',
      ];
      lines.push(row.map((cell) => sanitizeCsvCell(cell)).join(','));
    }

    return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
  }
}
