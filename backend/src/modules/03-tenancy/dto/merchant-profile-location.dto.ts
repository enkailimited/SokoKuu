import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class MerchantRouteWaypointDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  step!: number;

  @ApiProperty({ example: 'Panda bodaboda kuelekea kituo cha mwisho cha Kivule' })
  @IsString()
  @MaxLength(240)
  label!: string;

  @ApiProperty({ example: 'Geuka kulia baada ya duka la dawa kubwa' })
  @IsString()
  @MaxLength(500)
  hint!: string;

  @ApiPropertyOptional({ example: -6.9125 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-11.75)
  @Max(-0.95)
  lat?: number;

  @ApiPropertyOptional({ example: 39.1852 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(29.3)
  @Max(40.5)
  lng?: number;
}

export class UpdateMerchantProfileLocationDto {
  @ApiPropertyOptional({ example: -6.81954 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-11.75)
  @Max(-0.95)
  latitude?: number;

  @ApiPropertyOptional({ example: 39.27642 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(29.3)
  @Max(40.5)
  longitude?: number;

  @ApiPropertyOptional({ example: 'Kariakoo' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  wardName?: string;

  @ApiPropertyOptional({ example: 'Karibu na soko kuu la Kariakoo, lango la pili' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  streetLandmark?: string;

  @ApiPropertyOptional({ type: [MerchantRouteWaypointDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MerchantRouteWaypointDto)
  routeWaypoints?: MerchantRouteWaypointDto[];
}
