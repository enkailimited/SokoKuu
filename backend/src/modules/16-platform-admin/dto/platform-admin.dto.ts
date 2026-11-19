import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TZ_E164_REGEX } from '@modules/01-identity/dto/auth.dto';

export enum MerchantTierDto {
  WHOLESALE = 'WHOLESALE',
  RETAIL_DUKA = 'RETAIL_DUKA',
  HYBRID_STORE = 'HYBRID_STORE',
  MANUFACTURER_SUPPLIER = 'MANUFACTURER_SUPPLIER',
}

export class ListMerchantsQueryDto {
  @ApiPropertyOptional({ enum: MerchantTierDto })
  @IsOptional()
  @IsEnum(MerchantTierDto)
  tier?: MerchantTierDto;

  @ApiPropertyOptional({ example: 'Ilala' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional({ example: 'Kariakoo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ward?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isPlatformManaged?: boolean;
}

export class TogglePlatformManagedDto {
  @ApiProperty({
    description: 'Set true to route Merchant orders via Super Admin Helpdesk interceptor',
    example: false,
  })
  @IsBoolean()
  isPlatformManaged!: boolean;
}

export class ToggleMerchantMapDto {
  @ApiProperty({
    description: 'Enable or disable PostGIS geospatial map matrix access for this Merchant',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;
}

export class SetMerchantVerifiedDto {
  @ApiProperty({
    description:
      'Set true to verify the Merchant (opens storefront, marketplace visibility and order routing). Set false to suspend verification.',
    example: true,
  })
  @IsBoolean()
  isOpen!: boolean;
}

export class ToggleTenantMapRequestDto {
  @ApiProperty({ description: 'Target Merchant profile UUID' })
  @IsUUID()
  tenantBusinessId!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled!: boolean;
}

export class CreateLeadDto {
  @ApiProperty({ example: 'Kariakoo Mlimani Wholesale Hub' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  merchantName!: string;

  @ApiProperty({ example: 'Juma Bakari' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  ownerName!: string;

  @ApiProperty({ example: '+255712345678' })
  @IsString()
  @Matches(TZ_E164_REGEX, {
    message: 'ownerPhoneE164 must be a valid Tanzanian MSISDN (+2556XXXXXXXX or +2557XXXXXXXX)',
  })
  ownerPhoneE164!: string;

  @ApiProperty({ example: 'Kariakoo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  wardName!: string;

  @ApiProperty({ enum: MerchantTierDto, example: MerchantTierDto.RETAIL_DUKA })
  @IsEnum(MerchantTierDto)
  businessTier!: MerchantTierDto;

  @ApiProperty({ example: -6.8205 })
  @Type(() => Number)
  @IsNumber()
  @Min(-11.75)
  @Max(-0.95)
  latitude!: number;

  @ApiProperty({ example: 39.2725 })
  @Type(() => Number)
  @IsNumber()
  @Min(29.3)
  @Max(40.5)
  longitude!: number;

  @ApiPropertyOptional({ example: 10, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  gpsAccuracyMeters?: number;

  @ApiPropertyOptional({ description: 'Optional field agent UUID; defaults to authenticated user' })
  @IsOptional()
  @IsUUID()
  agentId?: string;
}

export class ConvertLeadDto {
  @ApiProperty({
    description: 'Expected optimistic lock version of soko_leads row',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ example: 'Ilala' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional({ example: 'Msimbazi Street' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  streetAddress?: string;
}
