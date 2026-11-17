import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PackagingUnit } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class QuoteLineItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ enum: PackagingUnit, example: 'SINGLE_KILO_LITRE' })
  @IsEnum(PackagingUnit)
  unitType!: PackagingUnit;

  @ApiProperty({ minimum: 1, example: 4 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CalculateQuoteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sellerBusinessId!: string;

  @ApiPropertyOptional({ minimum: 0, example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFeeTzs?: number;

  @ApiProperty({ type: [QuoteLineItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemDto)
  items!: QuoteLineItemDto[];
}

export class CalculateStandardPricingQuoteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  globalCatalogId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  globalProductUnitId!: string;

  @ApiProperty({ minimum: 1, example: 15 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ enum: ['RETAIL', 'WHOLESALE', 'REGIONAL', 'PROMOTIONAL'], default: 'WHOLESALE' })
  @IsOptional()
  @IsEnum(['RETAIL', 'WHOLESALE', 'REGIONAL', 'PROMOTIONAL'] as unknown as object)
  profileType?: 'RETAIL' | 'WHOLESALE' | 'REGIONAL' | 'PROMOTIONAL';

  @ApiPropertyOptional({ format: 'uuid', description: 'Optional Merchant clonedProductId to apply tenant-isolated override if present' })
  @IsOptional()
  @IsUUID()
  clonedProductId?: string;
}
