import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export const PRICING_CHANNELS = ['RETAIL', 'WHOLESALE', 'REGIONAL', 'PROMOTIONAL'] as const;
export type PricingChannelValue = (typeof PRICING_CHANNELS)[number];

export class CreatePricingTemplateDto {
  @ApiProperty({
    example: '1.6 L Katoni (Chupa 6)',
    description: 'Standalone, human-readable template name',
  })
  @IsString()
  @MaxLength(120)
  templateName!: string;

  @ApiProperty({ format: 'uuid', description: 'Canonical SystemUnit (LITRE, CARTON, KILOGRAM, GUNIA...)' })
  @IsUUID()
  systemUnitId!: string;

  @ApiPropertyOptional({ minimum: 1, default: 1, example: 6, description: 'Items inside one package' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  packItemCount?: number;

  @ApiProperty({
    example: '1.6',
    description: 'Display-only measure value (never used for currency arithmetic)',
  })
  @IsString()
  @MaxLength(24)
  unitMeasureValue!: string;

  @ApiProperty({ minimum: 1, example: 36, description: 'Exact integer Quarter-Quanta for stock deduction' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quarterQuantaTotal!: number;

  @ApiProperty({ enum: PRICING_CHANNELS, example: 'WHOLESALE' })
  @IsIn(PRICING_CHANNELS)
  pricingChannel!: PricingChannelValue;

  @ApiProperty({ minimum: 1, example: 3300, description: 'Whole TZS amount' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  standardPriceTzs!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePricingTemplateDto {
  @ApiPropertyOptional({ example: '1.6 L Katoni (Chupa 6)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  templateName?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  systemUnitId?: string;

  @ApiPropertyOptional({ minimum: 1, example: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  packItemCount?: number;

  @ApiPropertyOptional({ example: '1.6' })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  unitMeasureValue?: string;

  @ApiPropertyOptional({ minimum: 1, example: 36 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quarterQuantaTotal?: number;

  @ApiPropertyOptional({ enum: PRICING_CHANNELS })
  @IsOptional()
  @IsIn(PRICING_CHANNELS)
  pricingChannel?: PricingChannelValue;

  @ApiPropertyOptional({ minimum: 1, example: 3300 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  standardPriceTzs?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AttachPricingTemplatesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Complete set of template IDs to attach to this Global Catalog product',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  templateIds!: string[];
}
