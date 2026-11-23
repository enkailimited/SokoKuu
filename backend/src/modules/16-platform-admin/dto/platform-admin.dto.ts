import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
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

export class SetMerchantSuspensionDto {
  @ApiProperty({
    description:
      'true suspends the Merchant (accountStatus SUSPENDED) and blocks storefront/orders; false reinstates ACTIVE.',
    example: true,
  })
  @IsBoolean()
  suspended!: boolean;

  @ApiPropertyOptional({
    description: 'Mandatory reason when suspended=true (policy suspension notice)',
    example: 'Kagosi la sera ya jukwaa - tuhuma ya udanganyifu',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
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

  @ApiPropertyOptional({
    example: 'Nahitaji gunia 50 za sukari na mafuta ya kupikia kwa mwezi.',
    description: 'Optional quote / registration request details supplied by the applicant.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  quoteRequest?: string;
}

/**
 * Public (unauthenticated) merchant quote / registration request.
 *
 * Mirrors CreateLeadDto without `agentId` so an anonymous applicant cannot
 * attribute their lead to an arbitrary field agent.
 */
export class PublicLeadDto {
  @ApiProperty({ example: 'Duka la Jumla Kariakoo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  merchantName!: string;

  @ApiProperty({ example: 'Amina Hassan' })
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

  @ApiProperty({ example: 'Kariakoo, Dar es Salaam' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  wardName!: string;

  @ApiProperty({ enum: MerchantTierDto, example: MerchantTierDto.RETAIL_DUKA })
  @IsEnum(MerchantTierDto)
  @IsIn([MerchantTierDto.RETAIL_DUKA, MerchantTierDto.WHOLESALE, MerchantTierDto.HYBRID_STORE])
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

  @ApiPropertyOptional({ example: 5000, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  gpsAccuracyMeters?: number;

  @ApiPropertyOptional({
    example: 'Ninahitaji bei za jumla za sukari, unga na mafuta ya kupikia.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  quoteRequest?: string;
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
