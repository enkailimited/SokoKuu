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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { CurrentTenant, CurrentUser, Roles, TenantScoped } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { CentralizedUnitsPricingService } from './centralized-units-pricing.service';
import {
  CreateStandardPricingProfileDto,
  CreateSystemUnitDto,
  DefineGlobalProductUnitDto,
  PublishStandardPricesBatchDto,
  RecordExternalPurchaseReceiptDto,
  ResetMerchantPriceDto,
  SelectOrAmendMerchantPriceDto,
  UpdateSystemUnitDto,
} from './dto/centralized-units-pricing.dto';

@ApiTags('Catalog & Pricing Standards')
@ApiBearerAuth('bearer')
@Controller('api/v1')
export class CentralizedUnitsPricingController {
  constructor(private readonly service: CentralizedUnitsPricingService) {}

  @Get('admin/units')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER)
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOperation({ summary: 'List centralized platform system units (WEIGHT, VOLUME, PACKAGING)' })
  listUnits(@Query('includeInactive') includeInactive?: string) {
    return this.service.listSystemUnits(includeInactive === 'true');
  }

  @Post('admin/units')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a canonical system unit in system_units (SUPER_ADMIN)' })
  createUnit(@Body() dto: CreateSystemUnitDto) {
    return this.service.createSystemUnit(dto);
  }

  @Patch('admin/units/:unitId')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update or toggle active status of a system unit (SUPER_ADMIN)' })
  updateUnit(
    @Param('unitId', new ParseUUIDPipe()) unitId: string,
    @Body() dto: UpdateSystemUnitDto,
  ) {
    return this.service.updateSystemUnit(unitId, dto);
  }

  @Post('admin/marketplace/catalog/:globalCatalogId/units')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Define product-specific unit conversion to exact Quarter-Quanta (e.g., Gunia 25KG vs 50KG)',
  })
  defineProductUnit(
    @Param('globalCatalogId', new ParseUUIDPipe()) globalCatalogId: string,
    @Body() dto: DefineGlobalProductUnitDto,
  ) {
    return this.service.defineProductUnit(globalCatalogId, dto);
  }

  @Get('admin/marketplace/catalog/:globalCatalogId/units')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER)
  @ApiOperation({ summary: 'List product-specific unit definitions for a global catalog SKU' })
  listProductUnits(@Param('globalCatalogId', new ParseUUIDPipe()) globalCatalogId: string) {
    return this.service.listProductUnits(globalCatalogId);
  }

  @Post('admin/pricing/profiles')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a standard pricing profile (RETAIL, WHOLESALE, REGIONAL, PROMOTIONAL)' })
  createProfile(
    @Body() dto: CreateStandardPricingProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createPricingProfile(dto, user);
  }

  @Post('admin/marketplace/catalog/:globalCatalogId/standard-prices')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Publish versioned Admin standard prices (supersedes prior active version without touching Merchant overrides)',
  })
  publishStandardPrices(
    @Param('globalCatalogId', new ParseUUIDPipe()) globalCatalogId: string,
    @Body() dto: PublishStandardPricesBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.publishStandardPrices(globalCatalogId, dto, user);
  }

  @Get('marketplace/catalog/:globalCatalogId/standard-prices')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER)
  @ApiQuery({ name: 'includeHistory', required: false, type: Boolean })
  @ApiOperation({
    summary: 'Inspect Admin-defined Retail & Wholesale standard selling prices for a global catalog SKU',
  })
  getStandardPrices(
    @Param('globalCatalogId', new ParseUUIDPipe()) globalCatalogId: string,
    @Query('includeHistory') includeHistory?: string,
  ) {
    return this.service.getStandardPricesForCatalogItem(globalCatalogId, includeHistory === 'true');
  }

  @Post('merchant/catalog/:clonedProductId/select-or-amend-price')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RETAILER, Role.WHOLESALER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiOperation({
    summary: 'Select a platform standard selling price or store a tenant-isolated Merchant selling price amendment',
  })
  selectOrAmendMerchantPrice(
    @Param('clonedProductId', new ParseUUIDPipe()) clonedProductId: string,
    @Body() dto: SelectOrAmendMerchantPriceDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.service.selectOrAmendMerchantPrice(clonedProductId, dto, user, tenantContext);
  }

  @Post('merchant/catalog/:clonedProductId/reset-price')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RETAILER, Role.WHOLESALER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiOperation({
    summary: 'Clear Merchant override and revert cleanly to the active platform standard selling price',
  })
  resetMerchantPrice(
    @Param('clonedProductId', new ParseUUIDPipe()) clonedProductId: string,
    @Body() dto: ResetMerchantPriceDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.service.resetMerchantPriceToStandard(clonedProductId, dto, user, tenantContext);
  }

  @Post('merchant/purchases/external-receipt')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.RETAILER, Role.WHOLESALER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiOperation({
    summary: 'Record external supplier purchase order or GOODS_RECEIVED receipt updating weighted avg buying cost',
  })
  recordExternalPurchaseReceipt(
    @Body() dto: RecordExternalPurchaseReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.service.recordExternalPurchaseReceipt(dto, user, tenantContext);
  }
}
