import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TenantContext } from '@common/security/auth.types';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { PosSalesRequestDto } from './dto/pos-sales.dto';
import {
  buildSwahiliBulkBreakSms,
  QUANTA_PER_UNIT,
  safeMultiplyIntegerTzs,
} from './quarter-quanta.util';

export interface PosSalesReceiptResponse {
  receiptId: string;
  productId: string;
  inventoryId: string;
  quantaSold: number;
  paymentMethod: string;
  totalTzs: number;
  remainingLooseQuanta: number;
  remainingSealedPackages: number;
  bulkPackagesBroken: number;
  timestampEat: string;
  statusSuccess: boolean;
}

interface LockedProductRow {
  id: string;
  seller_business_id: string;
  name_sw: string;
  base_quarter_quanta_stock: number;
  sealed_bulk_packages_stock: number;
  quanta_per_sealed_package: number;
  unit_price_tzs: bigint;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  async recordPosSale(
    dto: PosSalesRequestDto,
    tenantContext?: TenantContext,
  ): Promise<PosSalesReceiptResponse> {
    const productId = dto.productId ?? dto.inventoryId;
    if (!productId) {
      throw new BadRequestException('Either productId or inventoryId is required.');
    }

    if (!tenantContext?.isSuperAdmin && !tenantContext?.businessId) {
      throw new ForbiddenException(
        'Authenticated Merchant tenant context is required for POS sales.',
      );
    }

    const receiptId = `RCP-${randomUUID().slice(0, 8).toUpperCase()}`;

    return this.prismaService.runInTransaction('Serializable', async (tx) => {
      const lockedRows = await tx.$queryRaw<LockedProductRow[]>`
        SELECT id::text AS id,
               seller_business_id::text AS seller_business_id,
               name_sw,
               base_quarter_quanta_stock,
               sealed_bulk_packages_stock,
               quanta_per_sealed_package,
               unit_price_tzs
          FROM products
         WHERE id = ${productId}::uuid
           AND is_active = TRUE
           FOR UPDATE
      `;

      const product = lockedRows[0];
      if (!product) {
        throw new NotFoundException(`Product ${productId} was not found or is inactive.`);
      }

      if (
        !tenantContext?.isSuperAdmin &&
        product.seller_business_id !== tenantContext?.businessId
      ) {
        throw new ForbiddenException(
          'Cross-Merchant inventory deduction denied for this product.',
        );
      }

      let currentLoose = Number(product.base_quarter_quanta_stock);
      let currentSealed = Number(product.sealed_bulk_packages_stock);
      let bulkPackagesBroken = 0;
      let creditedQuanta = 0;

      if (currentLoose < dto.quantityRequested) {
        const beforeTxTimestamp = new Date();
        try {
          await tx.$executeRaw`
            CALL auto_break_bulk_package(${productId}::uuid, ${dto.quantityRequested}::integer)
          `;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('INSUFFICIENT_SEALED_BULK') || message.includes('P0002')) {
            throw new ConflictException(
              `Insufficient shelf quanta (${currentLoose}) and sealed bulk packages (${currentSealed}) for requested ${dto.quantityRequested} quanta.`,
            );
          }
          throw error;
        }

        const refreshedRows = await tx.$queryRaw<
          Array<{ base_quarter_quanta_stock: number; sealed_bulk_packages_stock: number }>
        >`
          SELECT base_quarter_quanta_stock, sealed_bulk_packages_stock
            FROM products
           WHERE id = ${productId}::uuid
        `;

        const refreshed = refreshedRows[0];
        if (!refreshed) {
          throw new NotFoundException(`Product ${productId} vanished during bulk-breaking.`);
        }

        const previousSealed = currentSealed;
        currentLoose = Number(refreshed.base_quarter_quanta_stock);
        currentSealed = Number(refreshed.sealed_bulk_packages_stock);
        bulkPackagesBroken = Math.max(0, previousSealed - currentSealed);

        const logs = await tx.inventoryDeconstructionLog.findMany({
          where: {
            productId,
            createdAt: { gte: beforeTxTimestamp },
          },
          select: { creditedQuarterQuanta: true, bulkPackagesBroken: true },
        });
        creditedQuanta = logs.reduce((acc, item) => acc + item.creditedQuarterQuanta, 0);
        if (creditedQuanta === 0 && bulkPackagesBroken > 0) {
          creditedQuanta = bulkPackagesBroken * Number(product.quanta_per_sealed_package);
        }
      }

      if (currentLoose < dto.quantityRequested) {
        throw new ConflictException(
          `Insufficient shelf stock (${currentLoose}) for requested ${dto.quantityRequested} quanta.`,
        );
      }

      const remainingLoose = currentLoose - dto.quantityRequested;

      await tx.$executeRaw`
        UPDATE products
           SET base_quarter_quanta_stock = ${remainingLoose}::integer,
               version = version + 1,
               updated_at = NOW()
         WHERE id = ${productId}::uuid
      `;

      // unit_price_tzs is the price of one base unit = QUANTA_PER_UNIT (4) quarter-quanta,
      // mirrored from the selected global price tier (e.g. SINGLE_KILO_LITRE = TZS 4,200).
      // A POS sale is declared in quarter-quanta, so prorate by 4 to avoid overcharging 4x.
      const unitPriceBigInt = BigInt(product.unit_price_tzs);
      const totalTzs = Math.max(
        1,
        Math.round(safeMultiplyIntegerTzs(dto.quantityRequested, unitPriceBigInt) / QUANTA_PER_UNIT)
      );

      if (bulkPackagesBroken > 0) {
        const smsMessage = buildSwahiliBulkBreakSms(
          product.name_sw,
          bulkPackagesBroken,
          creditedQuanta,
          currentSealed,
        );

        await this.outboxService.enqueue(
          {
            aggregateType: 'Product',
            aggregateId: productId,
            eventType: 'BulkPackageBrokenEvent',
            routingKey: 'inventory.bulk.broken',
            payload: {
              productId,
              sellerBusinessId: product.seller_business_id,
              bulkPackagesBroken,
              creditedQuarterQuanta: creditedQuanta,
              remainingSealedPackages: currentSealed,
              smsMessage,
              smsLength: smsMessage.length,
            },
          },
          tx,
        );
      }

      if (tx.posSaleReceipt && typeof tx.posSaleReceipt.create === 'function') {
        await tx.posSaleReceipt.create({
          data: {
            receiptId,
            sellerBusinessId: product.seller_business_id,
            productId,
            quantaSold: dto.quantityRequested,
            paymentMethod: dto.paymentMethod,
            totalTzs: BigInt(totalTzs),
            collectedAmountTzs: BigInt(totalTzs),
            paymentVerified: dto.paymentMethod === 'CASH',
          },
        });
      }

      await this.outboxService.enqueue(
        {
          aggregateType: 'Product',
          aggregateId: productId,
          eventType: 'PosSaleRecordedEvent',
          routingKey: 'inventory.pos.sale_recorded',
          payload: {
            receiptId,
            productId,
            sellerBusinessId: product.seller_business_id,
            quantaSold: dto.quantityRequested,
            paymentMethod: dto.paymentMethod,
            totalTzs,
            remainingLooseQuanta: remainingLoose,
          },
        },
        tx,
      );

      return {
        receiptId,
        productId,
        inventoryId: productId,
        quantaSold: dto.quantityRequested,
        paymentMethod: dto.paymentMethod,
        totalTzs,
        remainingLooseQuanta: remainingLoose,
        remainingSealedPackages: currentSealed,
        bulkPackagesBroken,
        timestampEat: new Date().toISOString(),
        statusSuccess: true,
      };
    });
  }
}
