import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class BuyerConfirmPinDto {
  @ApiProperty({ example: '4821', pattern: '^\\d{4}$' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'buyerPin must be exactly 4 digits.' })
  buyerPin!: string;

  @ApiPropertyOptional({ example: 'SKQR-A1B2C3D4E5F6' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  qrToken?: string;
}

export class DriverConfirmPinDto {
  @ApiProperty({ example: '7394', pattern: '^\\d{4}$' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'driverPin must be exactly 4 digits.' })
  driverPin!: string;

  @ApiProperty({ minimum: 0, example: 14000 })
  @IsInt()
  @Min(0)
  collectedCashTzs!: number;

  @ApiPropertyOptional({ enum: ['CASH', 'M-PESA', 'TIGO-PESA'], default: 'CASH' })
  @IsOptional()
  @IsIn(['CASH', 'M-PESA', 'TIGO-PESA'])
  paymentMethod?: 'CASH' | 'M-PESA' | 'TIGO-PESA';

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mobileMoneyRef?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  mobileMoneyVerified?: boolean;
}

export class VerifyDoorstepQrDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 'SKQR-A1B2C3D4E5F6' })
  @IsString()
  @Matches(/^SKQR-[A-F0-9]{12}$/, {
    message: 'qrToken must match SKQR-<12HEX> format.',
  })
  qrToken!: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  qrSignature?: string;

  @ApiProperty({ example: '4821' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'buyerPin must be exactly 4 digits.' })
  buyerPin!: string;

  @ApiProperty({ example: '7394' })
  @IsString()
  @Matches(/^\d{4}$/, { message: 'driverPin must be exactly 4 digits.' })
  driverPin!: string;

  @ApiProperty({ minimum: 0, example: 14000 })
  @IsInt()
  @Min(0)
  collectedCashTzs!: number;
}

export class RetailerQrScanDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 'SKQR-A1B2C3D4E5F6' })
  @IsString()
  @Matches(/^SKQR-[A-F0-9]{12}$/)
  qrToken!: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  qrSignature?: string;
}

export class IsolatedBuyerPinDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: '4821' })
  @IsString()
  @Matches(/^\d{4}$/)
  buyerPin!: string;
}

export class IsolatedDriverPinDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: '7394' })
  @IsString()
  @Matches(/^\d{4}$/)
  driverPin!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  collectedCashTzs!: number;

  @ApiPropertyOptional({ enum: ['CASH', 'M-PESA', 'TIGO-PESA'], default: 'CASH' })
  @IsOptional()
  @IsIn(['CASH', 'M-PESA', 'TIGO-PESA'])
  paymentMethod?: 'CASH' | 'M-PESA' | 'TIGO-PESA';

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  mobileMoneyRef?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  mobileMoneyVerified?: boolean;
}
