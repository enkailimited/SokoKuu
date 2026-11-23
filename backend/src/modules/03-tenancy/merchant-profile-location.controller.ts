import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TenantContext } from '@common/security/auth.types';
import { CurrentTenant } from '@common/security/decorators';
import { JwtAuthGuard } from '@common/security/jwt-auth.guard';
import { TenantContextGuard } from '@common/security/tenant-context.guard';
import { UpdateMerchantProfileLocationDto } from './dto/merchant-profile-location.dto';
import { MerchantTenancyService } from './merchant-tenancy.service';

@ApiTags('Merchant Profile')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, TenantContextGuard)
@Controller('api/v1/merchant/profile/location')
export class MerchantProfileLocationController {
  constructor(private readonly merchantTenancyService: MerchantTenancyService) {}

  @Get()
  @ApiOperation({ summary: 'Get merchant store location and driver route waypoints' })
  @ApiResponse({ status: 200, description: 'Merchant location profile returned' })
  getLocation(@CurrentTenant() tenantContext?: TenantContext) {
    return this.merchantTenancyService.getMerchantLocation(tenantContext);
  }

  @Patch()
  @ApiOperation({
    summary:
      'Save merchant store GPS pin, ward/landmark, and ordered route waypoints (updates PostGIS location)',
  })
  @ApiResponse({ status: 200, description: 'Merchant location profile updated' })
  updateLocation(
    @Body() dto: UpdateMerchantProfileLocationDto,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.merchantTenancyService.updateMerchantLocation(dto, tenantContext);
  }
}
