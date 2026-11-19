import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupplierStockMovementType } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { IMAGEKIT_CDN_REGEX } from '@modules/05-catalog/dto/catalog.dto';

export const SUPPLIER_TZS_REGEX = /^\d+$/;

export class SupplierStockInDto {
  @ApiProperty({ format: 'uuid', description: 'Supplier warehouse Product id' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 1, description: 'Integer Quarter-Quanta received into warehouse' })
  @IsInt()
  @Min(1)
  quantityQuanta!: number;

  @ApiPropertyOptional({
    enum: [
      SupplierStockMovementType.FACTORY_PRODUCTION,
      SupplierStockMovementType.WAREHOUSE_STOCK_IN,
      SupplierStockMovementType.STOCK_ADJUSTMENT,
    ],
    default: SupplierStockMovementType.WAREHOUSE_STOCK_IN,
  })
  @IsOptional()
  @IsIn([
    SupplierStockMovementType.FACTORY_PRODUCTION,
    SupplierStockMovementType.WAREHOUSE_STOCK_IN,
    SupplierStockMovementType.STOCK_ADJUSTMENT,
  ])
  movementType?: SupplierStockMovementType;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;

  @ApiPropertyOptional({ maxLength: 80, description: 'Factory batch or delivery note reference' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  referenceId?: string;
}

export class SupplierExternalPurchaseReceiptDto {
  @ApiProperty({ format: 'uuid', description: 'Supplier warehouse Product id' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Admin-controlled global product unit used for the receipt',
  })
  @IsOptional()
  @IsUUID()
  globalProductUnitId?: string;

  @ApiPropertyOptional({ minimum: 1, description: 'Fallback Quarter-Quanta per unit' })
  @IsOptional()
  @IsInt()
  @Min(1)
  quarterQuantaPerUnit?: number;

  @ApiProperty({ example: 'Kilombero Sugar', description: 'Supplier or factory name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  supplierName!: string;

  @ApiPropertyOptional({ example: 'INV-2281', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  supplierReference?: string;

  @ApiPropertyOptional({
    enum: ['GOODS_RECEIVED', 'ORDER_CONFIRMED'],
    default: 'GOODS_RECEIVED',
  })
  @IsOptional()
  @IsIn(['GOODS_RECEIVED', 'ORDER_CONFIRMED'])
  receiptStatus?: 'GOODS_RECEIVED' | 'ORDER_CONFIRMED';

  @ApiProperty({ minimum: 1, example: 20 })
  @IsInt()
  @Min(1)
  quantityUnits!: number;

  @ApiProperty({ example: '2760000', description: 'Agreed whole-TZS total cost' })
  @Matches(SUPPLIER_TZS_REGEX)
  agreedTotalCostTzs!: string;

  @ApiPropertyOptional({ maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class ToggleSupplierAdminReceiveDto {
  @ApiProperty({
    example: true,
    description: 'Explicit consent for Super Admin helpdesk to receive and route Supplier orders',
  })
  @IsBoolean()
  allowAdminReceive!: boolean;
}

export class PublishSupplierListingDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  globalCatalogId!: string;

  @ApiProperty({ format: 'uuid', description: 'Admin-controlled system_units id' })
  @IsUUID()
  systemUnitId!: string;

  @ApiProperty({ example: '138000', description: 'BigInt whole-TZS bulk price for one system unit' })
  @Matches(SUPPLIER_TZS_REGEX)
  supplierBulkPriceTzs!: string;

  @ApiProperty({ minimum: 1, example: 1, description: 'Minimum order quantity in system units' })
  @IsInt()
  @Min(1)
  minOrderQuantity!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublishedToMarket?: boolean;

  @ApiPropertyOptional({ description: 'ImageKit CDN URL for the bulk listing image' })
  @IsOptional()
  @Matches(IMAGEKIT_CDN_REGEX)
  imagekitCdnUrl?: string;
}

export class UpdateSupplierDeliverySettingsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isFreeDeliveryEnabled!: boolean;

  @ApiProperty({ example: '0', description: '0 means free delivery on every B2B order' })
  @Matches(SUPPLIER_TZS_REGEX)
  freeDeliveryMinOrderTzs!: string;

  @ApiProperty({ example: '15000' })
  @Matches(SUPPLIER_TZS_REGEX)
  standardDeliveryFeeTzs!: string;

  @ApiProperty({ type: [String], example: ['Dar es Salaam', 'Pwani'] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  deliveryCoverageRegions!: string[];
}
