import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export const IMAGEKIT_CDN_REGEX = /^https:\/\/ik\.imagekit\.io\/[a-zA-Z0-9_-]+\/.+$/;

export enum PackagingUnitDto {
  CARTON = 'CARTON',
  DOZEN = 'DOZEN',
  PACK = 'PACK',
  UNIT = 'UNIT',
  SACK_50KG = 'SACK_50KG',
  SACK_25KG = 'SACK_25KG',
  QUARTER_KILO_LITRE = 'QUARTER_KILO_LITRE',
  HALF_KILO_LITRE = 'HALF_KILO_LITRE',
  THREE_QUARTER_KILO = 'THREE_QUARTER_KILO',
  SINGLE_KILO_LITRE = 'SINGLE_KILO_LITRE',
}

export class CreateCatalogCategoryDto {
  @ApiProperty({ example: 'UNGA_NA_NAFAKA' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  categoryCode!: string;

  @ApiProperty({ example: 'Unga na Nafaka' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameSw!: string;

  @ApiProperty({ example: 'Flour & Grains' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nameEn!: string;

  @ApiProperty({ example: '/sokokuutz/catalog/grains' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  imagekitFolderPath!: string;
}

export class AddGlobalCatalogItemDto {
  @ApiProperty({ example: 'GC-AZN-WHEAT-2KG' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  canonicalSku!: string;

  @ApiProperty({ example: 'Azania Unga wa Ngano (2kg)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fixedNameSw!: string;

  @ApiProperty({ example: 'Azania Wheat Flour (2kg)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fixedNameEn!: string;

  @ApiProperty({ example: 'UNGA_NA_NAFAKA' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  categoryCode!: string;

  @ApiProperty({
    example: 'https://ik.imagekit.io/sokokuutz/catalog/azania-wheat-2kg.webp',
    description: 'Absolute ImageKit.io CDN URL',
  })
  @IsString()
  @Matches(IMAGEKIT_CDN_REGEX, {
    message: 'imagekitCdnUrl must be an absolute ImageKit.io CDN URL (https://ik.imagekit.io/<id>/...)',
  })
  imagekitCdnUrl!: string;

  @ApiPropertyOptional({ example: 'QUANTA_250G', default: 'QUANTA_250G' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  baseQuantumUnit?: string;
}

export class CloneStandardCatalogDto {
  @ApiProperty({ description: 'UUID of soko_global_catalog item to clone' })
  @IsUUID()
  globalCatalogId!: string;

  @ApiPropertyOptional({
    description: 'Optional Merchant businessId (validated against server TenantContext)',
  })
  @IsOptional()
  @IsUUID()
  retailerBusinessId?: string;
}

export class CreateMerchantProductDto {
  @ApiPropertyOptional({ description: 'Optional canonical SKU reference in soko_global_catalog' })
  @IsOptional()
  @IsUUID()
  globalCatalogId?: string;

  @ApiProperty({ example: 'P01' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  smsItemCode!: string;

  @ApiProperty({ example: 'Kilombero Sugar' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nameEn!: string;

  @ApiProperty({ example: 'Sukari ya Kilombero' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nameSw!: string;

  @ApiProperty({ example: 150000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cartonPriceTzs!: number;

  @ApiProperty({ example: 39600 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dozenPriceTzs!: number;

  @ApiProperty({ example: 12000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  packPriceTzs!: number;

  @ApiProperty({ example: 3200 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitPriceTzs!: number;

  @ApiPropertyOptional({ example: 20, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  baseQuarterQuantaStock?: number;

  @ApiPropertyOptional({ example: 5, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sealedBulkPackagesStock?: number;

  @ApiPropertyOptional({ enum: PackagingUnitDto, default: PackagingUnitDto.SACK_50KG })
  @IsOptional()
  @IsEnum(PackagingUnitDto)
  sealedParentUnitType?: PackagingUnitDto;

  @ApiPropertyOptional({ example: 200, default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantaPerSealedPackage?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  lowStockThresholdQuanta?: number;
}

export class UpsertProductPriceTierDto {
  @ApiProperty({ enum: PackagingUnitDto })
  @IsEnum(PackagingUnitDto)
  unitType!: PackagingUnitDto;

  @ApiProperty({ example: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quarterQuantaPerUnit!: number;

  @ApiProperty({ example: 145000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  priceTzs!: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  isWholesaleTier!: boolean;
}

export class UpsertCustomMerchantUnitDto {
  @ApiProperty({ example: 'DEBE', description: 'Custom Tanzanian unit code (e.g., DEBE, SADO, DUMU)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  unitCode!: string;

  @ApiProperty({ example: 'Debe (20 KG)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  unitLabel!: string;

  @ApiProperty({ example: 20, description: 'Equivalent weight/volume in KG or Litres (must be exact 0.25 multiple)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.25)
  baseKg!: number;

  @ApiProperty({ example: 42000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  priceTzs!: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  isWholesaleTier!: boolean;
}
