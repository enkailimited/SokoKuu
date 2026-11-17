import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { CurrentTenant, CurrentUser } from '@common/security/decorators';
import { GeospatialService, StoresMapMatrixResponse } from './geospatial.service';

export class MapMatrixQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  originLat: number = -6.809;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  originLng: number = 39.255;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  @Max(200000)
  maxDistanceMeters: number = 25000;
}

@ApiTags('Merchant Branches')
@ApiBearerAuth('bearer')
@Controller('api/v1/geospatial')
export class GeospatialController {
  constructor(private readonly geospatialService: GeospatialService) {}

  @Get('stores-map-matrix')
  @ApiOperation({
    summary: 'Fetch PostGIS proximity-ordered Merchants matrix (fail-closed unless geospatial_map_enabled=TRUE or SUPER_ADMIN)',
  })
  @ApiQuery({ name: 'originLat', required: false, example: -6.809 })
  @ApiQuery({ name: 'originLng', required: false, example: 39.255 })
  @ApiQuery({ name: 'maxDistanceMeters', required: false, example: 25000 })
  @ApiResponse({ status: 200, description: 'PostGIS distance-ordered Merchant nodes' })
  @ApiResponse({ status: 403, description: 'Geospatial map access disabled for Merchant tenant' })
  getStoresMapMatrix(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext: TenantContext | undefined,
    @Query() query: MapMatrixQueryDto,
  ): Promise<StoresMapMatrixResponse> {
    return this.geospatialService.loadStoresMapMatrix(
      user,
      tenantContext,
      query.originLat,
      query.originLng,
      query.maxDistanceMeters,
    );
  }
}
