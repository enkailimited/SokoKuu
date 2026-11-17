import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@database/prisma.service';

@Injectable()
export class RetentionCronService {
  private readonly logger = new Logger(RetentionCronService.name);

  constructor(private readonly prismaService: PrismaService) {}

  @Cron('0 0 2 * * 0', { timeZone: 'Africa/Dar_es_Salaam' })
  async handleWeeklyRetentionCleanup(): Promise<{ purgedKeys: number; archivedLedgers: number }> {
    this.logger.log('Executing weekly database retention and cold archival maintenance...');
    return this.runRetentionMaintenance();
  }

  async runRetentionMaintenance(): Promise<{ purgedKeys: number; archivedLedgers: number }> {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    let purgedKeys = 0;
    let archivedLedgers = 0;

    await this.prismaService.runInTransaction('Serializable', async (tx) => {
      // 1. Purge aged idempotency keys older than 48h in bounded batches
      const agedKeys = await tx.idempotencyKey.findMany({
        where: {
          expiresAt: { lte: fortyEightHoursAgo },
        },
        take: 5000,
        select: { id: true },
      });

      if (agedKeys.length > 0) {
        const ids = agedKeys.map((k) => k.id);
        const res = await tx.idempotencyKey.deleteMany({
          where: { id: { in: ids } },
        });
        purgedKeys = res.count;
      }

      // 2. Archive SUCCESSFUL cash delivery ledgers reconciled >90 days ago into cash_delivery_ledgers_archive
      const agedLedgers = await tx.cashDeliveryLedger.findMany({
        where: {
          verificationStatus: 'SUCCESSFUL',
          reconciledAt: { lte: ninetyDaysAgo },
        },
        take: 5000,
      });

      for (const ledger of agedLedgers) {
        // Upsert into archive table
        await tx.$executeRaw`
          INSERT INTO cash_delivery_ledgers_archive (
            id,
            order_id,
            driver_user_id,
            one_time_qr_token,
            qr_token_expires_at,
            qr_token_signature,
            is_qr_token_consumed,
            buyer_confirmation_pin,
            driver_confirmation_pin,
            is_buyer_confirmed,
            is_driver_confirmed,
            expected_cash_amount,
            collected_cash_amount,
            payment_method,
            mobile_money_ref,
            mobile_money_verified,
            verification_status,
            buyer_confirmed_at,
            driver_confirmed_at,
            reconciled_at,
            eod_settled_at,
            eod_settlement_batch_id,
            version,
            created_at,
            updated_at,
            archived_at
          ) VALUES (
            ${ledger.id}::uuid,
            ${ledger.orderId}::uuid,
            ${ledger.driverUserId}::uuid,
            ${ledger.oneTimeQrToken},
            ${ledger.qrTokenExpiresAt},
            ${ledger.qrTokenSignature},
            ${ledger.isQrTokenConsumed},
            ${ledger.buyerConfirmationPin},
            ${ledger.driverConfirmationPin},
            ${ledger.isBuyerConfirmed},
            ${ledger.isDriverConfirmed},
            ${ledger.expectedCashAmount},
            ${ledger.collectedCashAmount},
            ${ledger.paymentMethod},
            ${ledger.mobileMoneyRef},
            ${ledger.mobileMoneyVerified},
            ${ledger.verificationStatus}::ledger_verification_status,
            ${ledger.buyerConfirmedAt},
            ${ledger.driverConfirmedAt},
            ${ledger.reconciledAt},
            ${ledger.eodSettledAt},
            ${ledger.eodSettlementBatchId}::uuid,
            ${ledger.version},
            ${ledger.createdAt},
            ${ledger.updatedAt},
            NOW()
          )
          ON CONFLICT (order_id) DO NOTHING
        `;

        await tx.cashDeliveryLedger.delete({
          where: { id: ledger.id },
        });
        archivedLedgers += 1;
      }
    });

    this.logger.log(`Retention maintenance completed: purgedKeys=${purgedKeys}, archivedLedgers=${archivedLedgers}`);
    return { purgedKeys, archivedLedgers };
  }
}
