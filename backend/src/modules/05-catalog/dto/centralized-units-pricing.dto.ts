import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateSystemUnitDto {
  @ApiProperty({ example: 'GUNIA' })
  @IsString()
  @MaxLength(32)
  unitCode!: string;

  @ApiProperty({ enum: ['WEIGHT', 'VOLUME', 'PACKAGING'], example: 'PACKAGING' })
  @IsIn(['WEIGHT', 'VOLUME', 'PACKAGING'])
  category!: 'WEIGHT' | 'VOLUME' | 'PACKAGING';

  @ApiProperty({ example: 'Gunia' })
  @IsString()
  @MaxLength(80)
  nameSw!: string;

  @ApiProperty({ example: 'Sack / Gunia' })
  @IsString()
  @MaxLength(80)
  nameEn!: string;

  @ApiProperty({ example: 'gunia' })
  @IsString()
  @MaxLength(16)
  abbreviation!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowFractional?: boolean;

  @ApiPropertyOptional({ example: 'QUANTA_250G' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  baseReferenceCode?: string;
}

export class UpdateSystemUnitDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameSw?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  abbreviation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowFractional?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  baseReferenceCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class DefineGlobalProductUnitDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  systemUnitId!: string;

  @ApiProperty({ minimum: 1, example: 100, description: '1 KG / 1 L = 4 Quarter-Quanta; 25 KG Gunia = 100Q' })
  @IsInt()
  @Min(1)
  quarterQuantaPerUnit!: number;

  @ApiPropertyOptional({ example: 'Gunia la 25 KG' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayLabelSw?: string;

  @ApiPropertyOptional({ example: '25 KG Sack' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayLabelEn?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isWholesaleUnit?: boolean;
}

export class CreateStandardPricingProfileDto {
  @ApiProperty({ example: 'RETAIL_STD_DEFAULT' })
  @IsString()
  @MaxLength(48)
  profileCode!: string;

  @ApiProperty({ enum: ['RETAIL', 'WHOLESALE', 'REGIONAL', 'PROMOTIONAL'], example: 'RETAIL' })
  @IsIn(['RETAIL', 'WHOLESALE', 'REGIONAL', 'PROMOTIONAL'])
  profileType!: 'RETAIL' | 'WHOLESALE' | 'REGIONAL' | 'PROMOTIONAL';

  @ApiProperty({ example: 'Bei Kuu ya Rejareja' })
  @IsString()
  @MaxLength(120)
  nameSw!: string;

  @ApiProperty({ example: 'Standard Retail Pricing' })
  @IsString()
  @MaxLength(120)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class PublishStandardPriceItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  globalProductUnitId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  pricingProfileId!: string;

  @ApiProperty({ enum: ['RETAIL', 'WHOLESALE', 'REGIONAL', 'PROMOTIONAL'] })
  @IsIn(['RETAIL', 'WHOLESALE', 'REGIONAL', 'PROMOTIONAL'])
  profileType!: 'RETAIL' | 'WHOLESALE' | 'REGIONAL' | 'PROMOTIONAL';

  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  minQty!: number;

  @ApiPropertyOptional({ minimum: 1, example: 9 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxQty?: number | null;

  @ApiProperty({ minimum: 1, example: 1500 })
  @IsInt()
  @Min(1)
  standardPriceTzs!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class PublishStandardPricesBatchDto {
  @ApiProperty({ type: [PublishStandardPriceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PublishStandardPriceItemDto)
  prices!: PublishStandardPriceItemDto[];
}

export class SelectOrAmendMerchantPriceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  globalProductUnitId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  standardPriceId!: string;

  @ApiPropertyOptional({ minimum: 1, example: 1600 })
  @IsOptional()
  @IsInt()
  @Min(1)
  amendedSellingPriceTzs?: number;
}

export class ResetMerchantPriceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  globalProductUnitId!: string;
}

export class RecordExternalPurchaseReceiptDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  clonedProductId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  globalProductUnitId?: string;

  @ApiProperty({ example: 'Kariakoo Millers Ltd' })
  @IsString()
  @MaxLength(180)
  supplierName!: string;

  @ApiPropertyOptional({ example: 'INV-2026-881' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  supplierReference?: string;

  @ApiPropertyOptional({ enum: ['ORDER_CONFIRMED', 'GOODS_RECEIVED'], default: 'GOODS_RECEIVED' })
  @IsOptional()
  @IsIn(['ORDER_CONFIRMED', 'GOODS_RECEIVED'])
  receiptStatus?: 'ORDER_CONFIRMED' | 'GOODS_RECEIVED';

  @ApiProperty({ minimum: 1, example: 2 })
  @IsInt()
  @Min(1)
  quantityUnits!: number;

  @ApiPropertyOptional({ minimum: 1, example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quarterQuantaPerUnit?: number;

  @ApiProperty({ minimum: 1, example: 100000 })
  @IsInt()
  @Min(1)
  agreedTotalCostTzs!: number;
}
