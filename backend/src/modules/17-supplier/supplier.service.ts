import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BusinessTier, OrderChannel, Prisma, SupplierStockMovementType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TenantContext } from '@common/security/auth.types';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';
import { computeWeightedAvgPurchaseCost } from '@modules/05-catalog/costing.util';
import { UTF8_BOM, sanitizeCsvCell } from '@modules/10-financials/csv-formula.util';
import {
  PublishSupplierListingDto,
  SupplierExternalPurchaseReceiptDto,
  SupplierStockInDto,
  ToggleSupplierAdminReceiveDto,
  UpdateSupplierDeliverySettingsDto,
} from './dto/supplier.dto';

const DECIMAL_ZERO = 0n;

function toTzsString(value: bigint | number | null | undefined): string {
  return (value ?? DECIMAL_ZERO).toString();
}

function safeNumber(value: bigint | number | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isSafeInteger(numeric) ? numeric : 0;
}

@Injectable()
export class SupplierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
  ) {}

  private async resolveSupplierId(
    tenantContext: TenantContext | undefined,
    client: Prisma.TransactionClient = this.prisma as Prisma.TransactionClient,
  ): Promise<string> {
    const businessId = tenantContext?.businessId;
    if (!businessId) {
      throw new ForbiddenException('Supplier tenant assignment is required.');
    }

    const profile = await client.businessProfile.findFirst({
      where: {
        id: businessId,
        tier: BusinessTier.MANUFACTURER_SUPPLIER,
      },
      select: { id: true },
    });

    if (!profile) {
      throw new ForbiddenException(
        'Authenticated Merchant is not a MANUFACTURER_SUPPLIER warehouse tenant.',
      );
    }
    return profile.id;
  }

  async listInventory(tenantContext?: TenantContext) {
    const supplierId = await this.resolveSupplierId(tenantContext);

    const products = await this.prisma.product.findMany({
      where: { sellerBusinessId: supplierId, isActive: true },
      include: {
        globalCatalog: {
          select: {
            id: true,
            canonicalSku: true,
            fixedNameSw: true,
            fixedNameEn: true,
            imagekitCdnUrl: true,
            staticImageUrl: true,
          },
        },
      },
      orderBy: { nameSw: 'asc' },
    });

    const catalogIds = products
      .map((product) => product.globalCatalogId)
      .filter((id): id is string => Boolean(id));

    const productUnits = catalogIds.length
      ? await this.prisma.globalProductUnit.findMany({
          where: { globalCatalogId: { in: catalogIds }, isActive: true },
          include: { systemUnit: true },
          orderBy: { quarterQuantaPerUnit: 'asc' },
        })
      : [];

    const unitsByCatalog = new Map<string, typeof productUnits>();
    for (const unit of productUnits) {
      const bucket = unitsByCatalog.get(unit.globalCatalogId) ?? [];
      bucket.push(unit);
      unitsByCatalog.set(unit.globalCatalogId, bucket);
    }

    return {
      supplierBusinessId: supplierId,
      totalWarehouseQuanta: products.reduce(
        (sum, product) => sum + Math.max(0, product.baseQuarterQuantaStock),
        0,
      ),
      items: products.map((product) => ({
        productId: product.id,
        smsItemCode: product.smsItemCode,
        nameSw: product.nameSw,
        nameEn: product.nameEn,
        globalCatalogId: product.globalCatalogId,
        canonicalSku: product.globalCatalog?.canonicalSku ?? null,
        imagekitCdnUrl:
          product.globalCatalog?.imagekitCdnUrl || product.globalCatalog?.staticImageUrl || '',
        availableQuantaStock: product.baseQuarterQuantaStock,
        sealedBulkPackagesStock: product.sealedBulkPackagesStock,
        sealedParentUnitType: product.sealedParentUnitType,
        quantaPerSealedPackage: product.quantaPerSealedPackage,
        lowStockThresholdQuanta: product.lowStockThresholdQuanta,
        unitConversions: (product.globalCatalogId
          ? unitsByCatalog.get(product.globalCatalogId) ?? []
          : []
        ).map((unit) => ({
          globalProductUnitId: unit.id,
          systemUnitId: unit.systemUnitId,
          unitCode: unit.systemUnit.unitCode,
          nameSw: unit.systemUnit.nameSw,
          nameEn: unit.systemUnit.nameEn,
          abbreviation: unit.systemUnit.abbreviation,
          quarterQuantaPerUnit: unit.quarterQuantaPerUnit,
          isWholesaleUnit: unit.isWholesaleUnit,
          displayLabelSw: unit.displayLabelSw,
          displayLabelEn: unit.displayLabelEn,
        })),
      })),
    };
  }

  async recordStockIn(
    dto: SupplierStockInDto,
    tenantContext: TenantContext | undefined,
    userId: string,
  ) {
    return this.prisma.runInTransaction('Serializable', async (tx) => {
      const supplierId = await this.resolveSupplierId(tenantContext, tx);

      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          seller_business_id: string;
          global_catalog_id: string | null;
          base_quarter_quanta_stock: number;
        }>
      >`
        SELECT id::text AS id,
               seller_business_id::text AS seller_business_id,
               global_catalog_id::text AS global_catalog_id,
               base_quarter_quanta_stock
          FROM products
         WHERE id = ${dto.productId}::uuid
           AND seller_business_id = ${supplierId}::uuid
           AND is_active = TRUE
           FOR UPDATE
      `;

      const product = lockedRows[0];
      if (!product) {
        throw new NotFoundException(`Supplier warehouse product ${dto.productId} was not found.`);
      }
      if (!product.global_catalog_id) {
        throw new UnprocessableEntityException(
          'Supplier warehouse product is not linked to soko_global_catalog.',
        );
      }

      const previousStock = Number(product.base_quarter_quanta_stock);
      const nextStock = previousStock + dto.quantityQuanta;
      if (!Number.isSafeInteger(nextStock) || nextStock < previousStock) {
        throw new BadRequestException('Stock-in overflowed the safe Quarter-Quanta limit.');
      }

      await tx.$executeRaw`
        UPDATE products
           SET base_quarter_quanta_stock = ${nextStock}::integer,
               version = version + 1,
               updated_at = NOW()
         WHERE id = ${dto.productId}::uuid
      `;

      const movement = await tx.supplierStockMovement.create({
        data: {
          supplierBusinessId: supplierId,
          productId: dto.productId,
          globalCatalogId: product.global_catalog_id,
          movementType:
            dto.movementType ?? SupplierStockMovementType.WAREHOUSE_STOCK_IN,
          quantityQuanta: dto.quantityQuanta,
          referenceType: dto.referenceId ? 'DELIVERY_NOTE' : 'MANUAL_STOCK_IN',
          referenceId: dto.referenceId ?? randomUUID(),
          recordedByUserId: userId,
          note: dto.note ?? null,
        },
        select: { id: true, createdAt: true },
      });

      await this.outboxService.enqueue(
        {
          aggregateType: 'SupplierStockMovement',
          aggregateId: movement.id,
          eventType: 'SupplierStockInRecordedEvent',
          routingKey: 'supplier.warehouse.stock_in',
          payload: {
            supplierBusinessId: supplierId,
            productId: dto.productId,
            quantityQuanta: dto.quantityQuanta,
            availableQuantaStock: nextStock,
            recordedByUserId: userId,
          },
        },
        tx,
      );

      return {
        productId: dto.productId,
        previousQuantaStock: previousStock,
        addedQuanta: dto.quantityQuanta,
        availableQuantaStock: nextStock,
        movementId: movement.id,
        recordedAtEat: movement.createdAt.toISOString(),
      };
    });
  }

  async recordExternalPurchaseReceipt(
    dto: SupplierExternalPurchaseReceiptDto,
    tenantContext: TenantContext | undefined,
    userId: string,
  ) {
    const status = dto.receiptStatus ?? 'GOODS_RECEIVED';

    return this.prisma.runInTransaction('Serializable', async (tx) => {
      const supplierId = await this.resolveSupplierId(tenantContext, tx);
      const lockedRows = await tx.$queryRaw<
        Array<{
          id: string;
          seller_business_id: string;
          global_catalog_id: string | null;
          base_quarter_quanta_stock: number;
        }>
      >`
        SELECT id::text AS id,
               seller_business_id::text AS seller_business_id,
               global_catalog_id::text AS global_catalog_id,
               base_quarter_quanta_stock
          FROM products
         WHERE id = ${dto.productId}::uuid
           AND seller_business_id = ${supplierId}::uuid
           AND is_active = TRUE
           FOR UPDATE
      `;

      const product = lockedRows[0];
      if (!product) {
        throw new NotFoundException(`Supplier warehouse product ${dto.productId} was not found.`);
      }
      if (!product.global_catalog_id) {
        throw new UnprocessableEntityException(
          'Supplier warehouse product is not linked to soko_global_catalog.',
        );
      }

      let quarterQuantaPerUnit = dto.quarterQuantaPerUnit ?? 0;
      if (dto.globalProductUnitId) {
        const productUnit = await tx.globalProductUnit.findFirst({
          where: {
            id: dto.globalProductUnitId,
            globalCatalogId: product.global_catalog_id,
            isActive: true,
          },
          select: { quarterQuantaPerUnit: true },
        });
        if (!productUnit) {
          throw new NotFoundException(
            `Global product unit ${dto.globalProductUnitId} does not belong to this SKU.`,
          );
        }
        quarterQuantaPerUnit = productUnit.quarterQuantaPerUnit;
      }

      if (!Number.isInteger(quarterQuantaPerUnit) || quarterQuantaPerUnit < 1) {
        throw new BadRequestException(
          'Either a valid globalProductUnitId or quarterQuantaPerUnit >= 1 is required.',
        );
      }

      const receivedQuanta = dto.quantityUnits * quarterQuantaPerUnit;
      if (!Number.isSafeInteger(receivedQuanta) || receivedQuanta < 1) {
        throw new BadRequestException('Received Quarter-Quanta quantity is outside the safe limit.');
      }

      const agreedTotalCost = BigInt(dto.agreedTotalCostTzs);
      if (agreedTotalCost < DECIMAL_ZERO) {
        throw new BadRequestException('agreedTotalCostTzs must not be negative.');
      }

      const previousReceipt = await tx.supplierPurchaseReceipt.findFirst({
        where: { supplierBusinessId: supplierId, productId: dto.productId },
        orderBy: { createdAt: 'desc' },
        select: { newWeightedAvgCostPerQuantumTzs: true },
      });
      const prevWeightedAvg = previousReceipt?.newWeightedAvgCostPerQuantumTzs ?? DECIMAL_ZERO;
      const previousStock = Number(product.base_quarter_quanta_stock);
      const costing = computeWeightedAvgPurchaseCost({
        existingStockQuanta: previousStock,
        existingWeightedAvgCostPerQuantumTzs: prevWeightedAvg,
        receivedQuanta,
        agreedTotalCostTzs: agreedTotalCost,
      });

      const isGoodsReceived = status === 'GOODS_RECEIVED';
      const newWeightedAvg = isGoodsReceived
        ? costing.weightedAvgBuyingCostPerQuantumTzs
        : prevWeightedAvg;
      const nextStock = isGoodsReceived ? costing.newTotalQuanta : previousStock;
      if (!Number.isSafeInteger(nextStock) || nextStock < previousStock) {
        throw new BadRequestException('Stock-in overflowed the safe Quarter-Quanta limit.');
      }

      const receipt = await tx.supplierPurchaseReceipt.create({
        data: {
          supplierBusinessId: supplierId,
          productId: dto.productId,
          globalCatalogId: product.global_catalog_id,
          globalProductUnitId: dto.globalProductUnitId ?? null,
          supplierName: dto.supplierName.trim(),
          supplierReference: dto.supplierReference?.trim() || null,
          receiptStatus: status,
          quantityUnits: dto.quantityUnits,
          quarterQuantaPerUnit,
          receivedQuanta,
          agreedTotalCostTzs: agreedTotalCost,
          costPerQuantumTzs: costing.lastBuyingPricePerQuantumTzs,
          previousWeightedAvgCostPerQuantumTzs: prevWeightedAvg,
          newWeightedAvgCostPerQuantumTzs: newWeightedAvg,
          recordedByUserId: userId,
          receivedAt: isGoodsReceived ? new Date() : null,
        },
        select: { id: true, createdAt: true },
      });

      if (isGoodsReceived) {
        await tx.$executeRaw`
          UPDATE products
             SET base_quarter_quanta_stock = ${nextStock}::integer,
                 version = version + 1,
                 updated_at = NOW()
           WHERE id = ${dto.productId}::uuid
        `;

        await tx.supplierStockMovement.create({
          data: {
            supplierBusinessId: supplierId,
            productId: dto.productId,
            globalCatalogId: product.global_catalog_id,
            movementType: SupplierStockMovementType.WAREHOUSE_STOCK_IN,
            quantityQuanta: receivedQuanta,
            referenceType: 'MANUAL_PURCHASE',
            referenceId: receipt.id,
            recordedByUserId: userId,
            note: dto.note
              ? dto.note
              : `Purchase receipt from ${dto.supplierName.trim()}`,
          },
        });
      }

      await this.outboxService.enqueue(
        {
          aggregateType: 'SupplierPurchaseReceipt',
          aggregateId: receipt.id,
          eventType: 'SupplierExternalPurchaseReceivedEvent',
          routingKey: 'supplier.purchase.received',
          payload: {
            receiptId: receipt.id,
            supplierBusinessId: supplierId,
            productId: dto.productId,
            supplierName: dto.supplierName.trim(),
            receivedQuanta,
            agreedTotalCostTzs: toTzsString(agreedTotalCost),
            receiptStatus: status,
            recordedByUserId: userId,
          },
        },
        tx,
      );

      return {
        receiptId: receipt.id,
        productId: dto.productId,
        receiptStatus: status,
        stockHydrated: isGoodsReceived,
        quantityUnits: dto.quantityUnits,
        quarterQuantaPerUnit,
        receivedQuanta,
        agreedTotalCostTzs: toTzsString(agreedTotalCost),
        previousQuantaStock: previousStock,
        availableQuantaStock: nextStock,
        lastBuyingPricePerQuantumTzs: toTzsString(costing.lastBuyingPricePerQuantumTzs),
        previousWeightedAvgCostPerQuantumTzs: toTzsString(prevWeightedAvg),
        newWeightedAvgCostPerQuantumTzs: toTzsString(newWeightedAvg),
        recordedAtEat: receipt.createdAt.toISOString(),
      };
    });
  }

  async setAllowAdminReceive(
    dto: ToggleSupplierAdminReceiveDto,
    tenantContext?: TenantContext,
  ) {
    const supplierId = await this.resolveSupplierId(tenantContext);
    const updated = await this.prisma.businessProfile.update({
      where: { id: supplierId },
      data: {
        allowAdminReceive: dto.allowAdminReceive,
        version: { increment: 1 },
      },
      select: { allowAdminReceive: true },
    });

    await this.outboxService.enqueue({
      aggregateType: 'SupplierReceiptConsent',
      aggregateId: supplierId,
      eventType: 'SupplierAdminReceiveToggledEvent',
      routingKey: 'supplier.admin_receive.toggled',
      payload: {
        supplierBusinessId: supplierId,
        allowAdminReceive: updated.allowAdminReceive,
      },
    });

    return { allowAdminReceive: updated.allowAdminReceive };
  }

  async publishListing(dto: PublishSupplierListingDto, tenantContext?: TenantContext) {
    const supplierId = await this.resolveSupplierId(tenantContext);
    const price = BigInt(dto.supplierBulkPriceTzs);
    if (price <= DECIMAL_ZERO) {
      throw new BadRequestException('supplierBulkPriceTzs must be greater than zero.');
    }

    return this.prisma.runInTransaction('Serializable', async (tx) => {
      const catalog = await tx.sokoGlobalCatalog.findFirst({
        where: { id: dto.globalCatalogId, isActive: true },
        select: { id: true },
      });
      if (!catalog) {
        throw new NotFoundException(`Global catalog item ${dto.globalCatalogId} is not active.`);
      }

      const productUnit = await tx.globalProductUnit.findFirst({
        where: {
          globalCatalogId: dto.globalCatalogId,
          systemUnitId: dto.systemUnitId,
          isActive: true,
        },
        select: { id: true, quarterQuantaPerUnit: true },
      });
      if (!productUnit) {
        throw new UnprocessableEntityException(
          'Selected system unit is not an active conversion for this global catalog item.',
        );
      }

      const warehouseProduct = await tx.product.findFirst({
        where: {
          sellerBusinessId: supplierId,
          globalCatalogId: dto.globalCatalogId,
          isActive: true,
        },
        select: { id: true },
      });
      if (!warehouseProduct) {
        throw new UnprocessableEntityException(
          'Record warehouse stock for this global catalog item before publishing it to Sokoni.',
        );
      }

      const listing = await tx.supplierCatalogListing.upsert({
        where: {
          supplierBusinessId_globalCatalogId_systemUnitId: {
            supplierBusinessId: supplierId,
            globalCatalogId: dto.globalCatalogId,
            systemUnitId: dto.systemUnitId,
          },
        },
        create: {
          supplierBusinessId: supplierId,
          globalCatalogId: dto.globalCatalogId,
          systemUnitId: dto.systemUnitId,
          supplierBulkPriceTzs: price,
          minOrderQuantity: dto.minOrderQuantity,
          isPublishedToMarket: dto.isPublishedToMarket ?? true,
          imagekitCdnUrl: dto.imagekitCdnUrl ?? '',
        },
        update: {
          supplierBulkPriceTzs: price,
          minOrderQuantity: dto.minOrderQuantity,
          isPublishedToMarket: dto.isPublishedToMarket ?? true,
          imagekitCdnUrl: dto.imagekitCdnUrl ?? '',
        },
        select: {
          id: true,
          globalCatalogId: true,
          systemUnitId: true,
          supplierBulkPriceTzs: true,
          minOrderQuantity: true,
          isPublishedToMarket: true,
          imagekitCdnUrl: true,
        },
      });

      await this.outboxService.enqueue(
        {
          aggregateType: 'SupplierCatalogListing',
          aggregateId: listing.id,
          eventType: 'SupplierListingPublishedEvent',
          routingKey: 'supplier.catalog.published',
          payload: {
            supplierBusinessId: supplierId,
            listingId: listing.id,
            globalCatalogId: dto.globalCatalogId,
            supplierBulkPriceTzs: toTzsString(price),
            isPublishedToMarket: listing.isPublishedToMarket,
          },
        },
        tx,
      );

      return {
        ...listing,
        supplierBulkPriceTzs: toTzsString(listing.supplierBulkPriceTzs),
        quarterQuantaPerUnit: productUnit.quarterQuantaPerUnit,
      };
    });
  }

  async getDeliverySettings(tenantContext?: TenantContext) {
    const supplierId = await this.resolveSupplierId(tenantContext);
    const profile = await this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: supplierId },
      select: {
        isFreeDeliveryEnabled: true,
        freeDeliveryMinOrderTzs: true,
        standardDeliveryFeeTzs: true,
        deliveryCoverageRegions: true,
        allowAdminReceive: true,
      },
    });

    return {
      isFreeDeliveryEnabled: profile.isFreeDeliveryEnabled,
      allowAdminReceive: profile.allowAdminReceive,
      freeDeliveryMinOrderTzs: toTzsString(profile.freeDeliveryMinOrderTzs),
      standardDeliveryFeeTzs: toTzsString(profile.standardDeliveryFeeTzs),
      deliveryCoverageRegions: profile.deliveryCoverageRegions,
      policy: profile.isFreeDeliveryEnabled
        ? profile.freeDeliveryMinOrderTzs === DECIMAL_ZERO
          ? 'FREE_DELIVERY_ALL_ORDERS'
          : 'FREE_DELIVERY_ABOVE_MINIMUM'
        : 'STANDARD_DELIVERY_FEE',
    };
  }

  async updateDeliverySettings(
    dto: UpdateSupplierDeliverySettingsDto,
    tenantContext?: TenantContext,
  ) {
    const supplierId = await this.resolveSupplierId(tenantContext);
    const profile = await this.prisma.businessProfile.update({
      where: { id: supplierId },
      data: {
        isFreeDeliveryEnabled: dto.isFreeDeliveryEnabled,
        freeDeliveryMinOrderTzs: BigInt(dto.freeDeliveryMinOrderTzs),
        standardDeliveryFeeTzs: BigInt(dto.standardDeliveryFeeTzs),
        deliveryCoverageRegions: dto.deliveryCoverageRegions,
        version: { increment: 1 },
      },
      select: {
        isFreeDeliveryEnabled: true,
        freeDeliveryMinOrderTzs: true,
        standardDeliveryFeeTzs: true,
        deliveryCoverageRegions: true,
        allowAdminReceive: true,
      },
    });

    return {
      isFreeDeliveryEnabled: profile.isFreeDeliveryEnabled,
      allowAdminReceive: profile.allowAdminReceive,
      freeDeliveryMinOrderTzs: toTzsString(profile.freeDeliveryMinOrderTzs),
      standardDeliveryFeeTzs: toTzsString(profile.standardDeliveryFeeTzs),
      deliveryCoverageRegions: profile.deliveryCoverageRegions,
    };
  }

  async listSupplierMarketplace() {
    const listings = await this.prisma.supplierCatalogListing.findMany({
      where: {
        isPublishedToMarket: true,
        supplier: { tier: BusinessTier.MANUFACTURER_SUPPLIER, isOpen: true },
      },
      include: {
        supplier: {
          select: {
            id: true,
            businessName: true,
            isFreeDeliveryEnabled: true,
            freeDeliveryMinOrderTzs: true,
            standardDeliveryFeeTzs: true,
            deliveryCoverageRegions: true,
          },
        },
        globalCatalog: {
          select: {
            id: true,
            canonicalSku: true,
            fixedNameSw: true,
            fixedNameEn: true,
            imagekitCdnUrl: true,
          },
        },
        systemUnit: { select: { id: true, unitCode: true, nameSw: true, abbreviation: true } },
      },
      orderBy: [{ supplierBulkPriceTzs: 'asc' }],
    });

    const supplierIds = Array.from(new Set(listings.map((listing) => listing.supplierBusinessId)));
    const catalogIds = Array.from(new Set(listings.map((listing) => listing.globalCatalogId)));
    const unitKeys = listings.map(
      (listing) => `${listing.globalCatalogId}:${listing.systemUnitId}`,
    );

    const [products, productUnits] = await Promise.all([
      supplierIds.length
        ? this.prisma.product.findMany({
            where: {
              sellerBusinessId: { in: supplierIds },
              globalCatalogId: { in: catalogIds },
              isActive: true,
            },
            select: {
              id: true,
              sellerBusinessId: true,
              globalCatalogId: true,
              baseQuarterQuantaStock: true,
            },
          })
        : Promise.resolve([]),
      unitKeys.length
        ? this.prisma.globalProductUnit.findMany({
            where: {
              globalCatalogId: { in: catalogIds },
              isActive: true,
            },
            select: { globalCatalogId: true, systemUnitId: true, quarterQuantaPerUnit: true },
          })
        : Promise.resolve([]),
    ]);

    const productByKey = new Map(
      products.map((product) => [
        `${product.sellerBusinessId}:${product.globalCatalogId}`,
        product,
      ]),
    );
    const qpuByKey = new Map(
      productUnits.map((unit) => [
        `${unit.globalCatalogId}:${unit.systemUnitId}`,
        unit.quarterQuantaPerUnit,
      ]),
    );

    return {
      items: listings.map((listing) => {
        const warehouseProduct = productByKey.get(
          `${listing.supplierBusinessId}:${listing.globalCatalogId}`,
        );
        const quarterQuantaPerUnit = qpuByKey.get(
          `${listing.globalCatalogId}:${listing.systemUnitId}`,
        );
        const availableQuantaStock = warehouseProduct?.baseQuarterQuantaStock ?? 0;
        const maxOrderQuantity =
          quarterQuantaPerUnit && quarterQuantaPerUnit > 0
            ? Math.floor(availableQuantaStock / quarterQuantaPerUnit)
            : 0;

        return {
          listingId: listing.id,
          supplierBusinessId: listing.supplierBusinessId,
          supplierName: listing.supplier.businessName,
          productId: warehouseProduct?.id ?? null,
          globalCatalogId: listing.globalCatalogId,
          canonicalSku: listing.globalCatalog.canonicalSku,
          nameSw: listing.globalCatalog.fixedNameSw,
          nameEn: listing.globalCatalog.fixedNameEn,
          imagekitCdnUrl: listing.imagekitCdnUrl || listing.globalCatalog.imagekitCdnUrl,
          systemUnitId: listing.systemUnitId,
          systemUnitCode: listing.systemUnit.unitCode,
          systemUnitLabelSw: listing.systemUnit.nameSw,
          quarterQuantaPerUnit: quarterQuantaPerUnit ?? 1,
          supplierBulkPriceTzs: toTzsString(listing.supplierBulkPriceTzs),
          minOrderQuantity: listing.minOrderQuantity,
          availableQuantaStock,
          maxOrderQuantity,
          isFreeDeliveryEnabled: listing.supplier.isFreeDeliveryEnabled,
          freeDeliveryMinOrderTzs: toTzsString(listing.supplier.freeDeliveryMinOrderTzs),
          standardDeliveryFeeTzs: toTzsString(listing.supplier.standardDeliveryFeeTzs),
          deliveryCoverageRegions: listing.supplier.deliveryCoverageRegions,
          isAvailable: Boolean(warehouseProduct && maxOrderQuantity >= listing.minOrderQuantity),
        };
      }),
    };
  }

  async listIncomingOrders(tenantContext?: TenantContext) {
    const supplierId = await this.resolveSupplierId(tenantContext);
    const orders = await this.prisma.order.findMany({
      where: {
        sellerBusinessId: supplierId,
        orderChannel: OrderChannel.SUPPLIER_TO_WHOLESALER,
      },
      include: {
        buyer: { select: { id: true, fullName: true, phoneE164: true } },
        driver: { select: { id: true, fullName: true, phoneE164: true } },
        cashLedger: {
          select: {
            id: true,
            verificationStatus: true,
            isBuyerConfirmed: true,
            isDriverConfirmed: true,
            isQrTokenConsumed: true,
          },
        },
        items: {
          include: {
            product: {
              select: { id: true, nameSw: true, nameEn: true, globalCatalogId: true },
            },
          },
        },
      },
      orderBy: { placedAt: 'desc' },
    });

    return {
      supplierBusinessId: supplierId,
      orders: orders.map((order) => ({
        orderId: order.id,
        orderRef: order.orderRef,
        status: order.status,
        orderChannel: order.orderChannel,
        placedAtEat: order.placedAt.toISOString(),
        dispatchedAtEat: order.dispatchedAt?.toISOString() ?? null,
        buyer: order.buyer,
        driver: order.driver,
        sellerBusinessId: order.sellerBusinessId,
        expectedTotalTzs: toTzsString(order.expectedTotalTzs),
        deliveryFeeTzs: toTzsString(order.deliveryFeeTzs),
        isFreeDeliveryApplied: order.deliveryFeeTzs === DECIMAL_ZERO,
        dualPinStatus: order.cashLedger
          ? {
              verificationStatus: order.cashLedger.verificationStatus,
              isBuyerConfirmed: order.cashLedger.isBuyerConfirmed,
              isDriverConfirmed: order.cashLedger.isDriverConfirmed,
              isQrTokenConsumed: order.cashLedger.isQrTokenConsumed,
            }
          : null,
        items: order.items.map((item) => ({
          productId: item.productId,
          nameSw: item.product.nameSw,
          nameEn: item.product.nameEn,
          quantity: item.quantity,
          quarterQuanta: safeNumber(item.baseUnitsTotal),
          lineTotalTzs: toTzsString(item.lineTotalTzs),
        })),
      })),
    };
  }

  private async buildReport(tenantContext?: TenantContext) {
    const supplierId = await this.resolveSupplierId(tenantContext);
    const supplier = await this.prisma.businessProfile.findUniqueOrThrow({
      where: { id: supplierId },
      select: { businessName: true },
    });

    const supplierOrderScope = {
      sellerBusinessId: supplierId,
      orderChannel: OrderChannel.SUPPLIER_TO_WHOLESALER,
    } as const;

    const [deliveredAggregate, deliveredCount, pendingDispatchCount, freeDeliveryCount, orderItems] =
      await Promise.all([
        this.prisma.order.aggregate({
          where: { ...supplierOrderScope, status: 'DELIVERED' },
          _sum: { paidAmountTzs: true },
        }),
        this.prisma.order.count({ where: { ...supplierOrderScope, status: 'DELIVERED' } }),
        this.prisma.order.count({ where: { ...supplierOrderScope, status: 'PLACED' } }),
        this.prisma.order.count({
          where: { ...supplierOrderScope, deliveryFeeTzs: DECIMAL_ZERO },
        }),
        this.prisma.orderItem.findMany({
          where: { order: supplierOrderScope },
          select: {
            productId: true,
            quantity: true,
            baseUnitsTotal: true,
            lineTotalTzs: true,
            product: { select: { nameSw: true, nameEn: true } },
          },
        }),
      ]);

    const topProductMap = new Map<
      string,
      { productId: string; nameSw: string; nameEn: string; quantity: number; quanta: number; revenueTzs: bigint }
    >();
    for (const item of orderItems) {
      const current = topProductMap.get(item.productId) ?? {
        productId: item.productId,
        nameSw: item.product.nameSw,
        nameEn: item.product.nameEn,
        quantity: 0,
        quanta: 0,
        revenueTzs: DECIMAL_ZERO,
      };
      current.quantity += item.quantity;
      current.quanta += safeNumber(item.baseUnitsTotal);
      current.revenueTzs += BigInt(item.lineTotalTzs);
      topProductMap.set(item.productId, current);
    }

    const topProducts = Array.from(topProductMap.values())
      .sort((a, b) => b.quanta - a.quanta)
      .slice(0, 10)
      .map((item) => ({
        ...item,
        revenueTzs: toTzsString(item.revenueTzs),
      }));

    const warehouseProducts = await this.prisma.product.findMany({
      where: { sellerBusinessId: supplierId, isActive: true },
      select: { id: true, globalCatalogId: true, baseQuarterQuantaStock: true },
    });
    const listings = await this.prisma.supplierCatalogListing.findMany({
      where: { supplierBusinessId: supplierId },
      select: { supplierBulkPriceTzs: true, globalCatalogId: true, systemUnitId: true },
    });
    const productUnits = await this.prisma.globalProductUnit.findMany({
      where: {
        globalCatalogId: {
          in: Array.from(
            new Set(
              warehouseProducts
                .map((p) => p.globalCatalogId)
                .filter((id): id is string => Boolean(id)),
            ),
          ),
        },
      },
      select: { globalCatalogId: true, systemUnitId: true, quarterQuantaPerUnit: true },
    });

    let warehouseValuationTzs = DECIMAL_ZERO;
    for (const product of warehouseProducts) {
      if (!product.globalCatalogId) continue;
      const listing = listings.find((entry) => entry.globalCatalogId === product.globalCatalogId);
      if (!listing) continue;
      const unit = productUnits.find(
        (entry) =>
          entry.globalCatalogId === product.globalCatalogId &&
          entry.systemUnitId === listing.systemUnitId &&
          entry.quarterQuantaPerUnit > 0,
      );
      const quantaPerUnit = BigInt(unit?.quarterQuantaPerUnit ?? 1);
      warehouseValuationTzs +=
        (BigInt(product.baseQuarterQuantaStock) * listing.supplierBulkPriceTzs) / quantaPerUnit;
    }

    return {
      supplierBusinessId: supplierId,
      supplierName: supplier.businessName,
      totalB2bRevenueTzs: toTzsString(deliveredAggregate._sum.paidAmountTzs ?? DECIMAL_ZERO),
      totalOrdersFulfilled: deliveredCount,
      pendingDispatchCount,
      freeDeliveryOrdersSponsored: freeDeliveryCount,
      topProducts,
      warehouseValuationTzs: toTzsString(warehouseValuationTzs),
    };
  }

  async getReportsSummary(tenantContext?: TenantContext) {
    return this.buildReport(tenantContext);
  }

  async generateSwahiliCsv(tenantContext?: TenantContext): Promise<string> {
    const report = await this.buildReport(tenantContext);
    const rows: unknown[][] = [
      ['Ripoti ya Supplier - SokoKuu TZ'],
      ['Jina la Supplier', report.supplierName],
      ['Mapato yote ya B2B (TZS)', report.totalB2bRevenueTzs],
      ['Oda zilizotimizwa', report.totalOrdersFulfilled],
      ['Oda zinazosubiri usafirishaji', report.pendingDispatchCount],
      ['Oda za Usafiri wa Bure zilizofadhiliwa', report.freeDeliveryOrdersSponsored],
      ['Thamani ya Ghala (TZS)', report.warehouseValuationTzs],
      [],
      ['Bidhaa', 'Jina (SW)', 'Jina (EN)', 'Kiasi (vitengo)', 'Quarter-Quanta', 'Mapato (TZS)'],
      ...report.topProducts.map((product) => [
        product.productId,
        product.nameSw,
        product.nameEn,
        product.quantity,
        product.quanta,
        product.revenueTzs,
      ]),
    ];

    return `${UTF8_BOM}${rows
      .map((row) => row.map((cell) => sanitizeCsvCell(cell)).join(','))
      .join('\r\n')}\r\n`;
  }
}
