import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export enum PosPaymentMethod {
  CASH = 'CASH',
  M_PESA = 'M_PESA',
  TIGO_PESA = 'TIGO_PESA',
  AIRTEL_MONEY = 'AIRTEL_MONEY',
}

export class PosSalesRequestDto {
  @ApiPropertyOptional({ description: 'Product UUID (alias for inventoryId)' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Inventory Product UUID' })
  @IsOptional()
  @IsUUID()
  inventoryId?: string;

  @ApiProperty({
    description: 'Quantity requested in integer Quarter-Quanta (e.g., 1 = Robo, 4 = 1KG)',
    example: 8,
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantityRequested!: number;

  @ApiProperty({ enum: PosPaymentMethod, example: PosPaymentMethod.CASH })
  @IsEnum(PosPaymentMethod)
  paymentMethod!: PosPaymentMethod;
}
