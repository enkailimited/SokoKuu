import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderChannel, OrderOrigin, PackagingUnit } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum OrderModeDto {
  INSTANT = 'INSTANT',
  SCHEDULED = 'SCHEDULED',
}

export class CreateOrderLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ enum: PackagingUnit, example: 'SINGLE_KILO_LITRE' })
  @IsEnum(PackagingUnit)
  unitType!: PackagingUnit;

  @ApiProperty({ minimum: 1, example: 2 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Published Supplier listing id for SUPPLIER_TO_WHOLESALER orders',
  })
  @IsOptional()
  @IsUUID()
  supplierListingId?: string;
}

export class CreateOrderRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sellerBusinessId!: string;

  @ApiPropertyOptional({ enum: OrderOrigin, default: 'PWA_ONLINE' })
  @IsOptional()
  @IsEnum(OrderOrigin)
  originChannel?: OrderOrigin;

  @ApiPropertyOptional({
    enum: OrderChannel,
    default: OrderChannel.RETAIL_MARKETPLACE,
  })
  @IsOptional()
  @IsEnum(OrderChannel)
  orderChannel?: OrderChannel;

  @ApiPropertyOptional({ enum: ['CASH', 'M-PESA', 'TIGO-PESA'], default: 'CASH' })
  @IsOptional()
  @IsIn(['CASH', 'M-PESA', 'TIGO-PESA'])
  paymentMethod?: 'CASH' | 'M-PESA' | 'TIGO-PESA';

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFeeTzs?: number;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  rawSmsPayload?: string;

  @ApiPropertyOptional({ enum: OrderModeDto, default: OrderModeDto.INSTANT })
  @IsOptional()
  @IsEnum(OrderModeDto)
  orderMode?: OrderModeDto;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Scheduled delivery date for zone/date routing or SCHEDULED orderMode (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'scheduledDeliveryDate must use YYYY-MM-DD format.',
  })
  scheduledDeliveryDate?: string;

  @ApiProperty({ type: [CreateOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  items!: CreateOrderLineDto[];
}

export class BatchMerchantOrderEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sellerBusinessId!: string;

  @ApiPropertyOptional({
    enum: OrderChannel,
    default: OrderChannel.RETAIL_MARKETPLACE,
  })
  @IsOptional()
  @IsEnum(OrderChannel)
  orderChannel?: OrderChannel;

  @ApiPropertyOptional({ enum: ['CASH', 'M-PESA', 'TIGO-PESA'], default: 'CASH' })
  @IsOptional()
  @IsIn(['CASH', 'M-PESA', 'TIGO-PESA'])
  paymentMethod?: 'CASH' | 'M-PESA' | 'TIGO-PESA';

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFeeTzs?: number;

  @ApiProperty({ type: [CreateOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  items!: CreateOrderLineDto[];
}

export class SubmitBatchOrdersDto {
  @ApiPropertyOptional({ enum: OrderModeDto, default: OrderModeDto.INSTANT })
  @IsOptional()
  @IsEnum(OrderModeDto)
  orderMode?: OrderModeDto;

  @ApiPropertyOptional({ example: '2026-11-30', description: 'Required YYYY-MM-DD when orderMode is SCHEDULED' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'scheduledDeliveryDate must use YYYY-MM-DD format.',
  })
  scheduledDeliveryDate?: string;

  @ApiPropertyOptional({ enum: OrderOrigin, default: 'PWA_ONLINE' })
  @IsOptional()
  @IsEnum(OrderOrigin)
  originChannel?: OrderOrigin;

  @ApiPropertyOptional({ enum: ['CASH', 'M-PESA', 'TIGO-PESA'], default: 'CASH' })
  @IsOptional()
  @IsIn(['CASH', 'M-PESA', 'TIGO-PESA'])
  paymentMethod?: 'CASH' | 'M-PESA' | 'TIGO-PESA';

  @ApiProperty({ type: [BatchMerchantOrderEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchMerchantOrderEntryDto)
  orders!: BatchMerchantOrderEntryDto[];
}

export class CancelOrderDto {
  @ApiPropertyOptional({ maxLength: 300, example: 'Buyer requested doorstep cancellation' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
