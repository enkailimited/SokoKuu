import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '@common/security/auth.types';
import { CurrentUser, Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { AdminMerchantsService } from './admin-merchants.service';
import {
  ListMerchantsQueryDto,
  ToggleMerchantMapDto,
  TogglePlatformManagedDto,
  ToggleTenantMapRequestDto,
} from './dto/platform-admin.dto';

@ApiTags('Platform Administration')
@ApiBearerAuth('bearer')
@Roles(Role.SUPER_ADMIN)
@Controller('api/v1/admin/merchants')
export class AdminMerchantsController {
  constructor(private readonly adminMerchantsService: AdminMerchantsService) {}

  @Get()
  @ApiOperation({
    summary: 'Converted & Verified Merchants Directory (Wafanyabiashara & Mipangilio)',
    description:
      'Lists converted and verified Merchants with optional tier, district, ward, and platform-managed filtering.',
  })
  @ApiResponse({ status: 200, description: 'Verified Merchants directory returned' })
  listVerifiedMerchants(@Query() query: ListMerchantsQueryDto) {
    return this.adminMerchantsService.listMerchants(query);
  }

  @Patch(':businessId/platform-managed')
  @ApiOperation({
    summary: 'Toggle Merchant is_platform_managed Order Interceptor Flag',
  })
  @ApiResponse({ status: 200, description: 'Merchant platform-managed flag updated' })
  @ApiResponse({ status: 404, description: 'Merchant profile not found' })
  togglePlatformManaged(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Body() dto: TogglePlatformManagedDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminMerchantsService.setPlatformManagedFlag(
      businessId,
      dto.isPlatformManaged,
      admin.sub,
    );
  }

  @Post(':merchantId/toggle-map')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle Merchant Geospatial Map Matrix Permission (SUPER_ADMIN)',
    description:
      'Enables or disables `business_profiles.geospatial_map_enabled` for a specific Merchant.',
  })
  toggleMerchantGeospatialMap(
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Body() dto: ToggleMerchantMapDto,
  ) {
    return this.adminMerchantsService.setGeospatialMapEnabled(merchantId, dto.enabled);
  }
}

@ApiTags('Platform Administration')
@ApiBearerAuth('bearer')
@Roles(Role.SUPER_ADMIN)
@Controller('api/v1/admin/tenant')
export class AdminTenantMapController {
  constructor(private readonly adminMerchantsService: AdminMerchantsService) {}

  @Post('toggle-map')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle Merchant Geospatial Map Matrix Access (Legacy Blueprint Alias)',
  })
  toggleTenantMap(@Body() dto: ToggleTenantMapRequestDto) {
    return this.adminMerchantsService.setGeospatialMapEnabled(
      dto.tenantBusinessId,
      dto.enabled,
    );
  }
}
