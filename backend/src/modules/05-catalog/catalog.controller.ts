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
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TenantContext } from '@common/security/auth.types';
import { CurrentTenant, Roles, TenantScoped } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { CatalogService } from './catalog.service';
import {
  AddGlobalCatalogItemDto,
  CloneStandardCatalogDto,
  CreateCatalogCategoryDto,
  CreateMerchantProductDto,
  PublishMarketStockDto,
  UpdateFreeDeliveryDto,
  UpdateGlobalCatalogItemDto,
  UpsertCustomMerchantUnitDto,
  UpsertProductPriceTierDto,
} from './dto/catalog.dto';

@ApiTags('Catalog')
@ApiBearerAuth('bearer')
@Controller('api/v1')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('admin/marketplace/catalog/categories')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.CONSUMER, Role.SUPPLIER)
  @ApiOperation({ summary: 'List all SokoKuu catalog categories' })
  listCategories() {
    return this.catalogService.listCategories();
  }

  @Post('admin/marketplace/catalog/categories')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create locked soko_catalog_categories entry with ImageKit folder' })
  @ApiResponse({ status: 201, description: 'Catalog category created' })
  @ApiResponse({ status: 409, description: 'Category code already exists' })
  createCategory(@Body() dto: CreateCatalogCategoryDto) {
    return this.catalogService.createCategory(dto);
  }

  @Post('admin/marketplace/catalog/add-item')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Add canonical SKU to soko_global_catalog under SERIALIZABLE isolation',
  })
  @ApiResponse({ status: 201, description: 'Canonical SKU ingested' })
  @ApiResponse({ status: 409, description: 'Duplicate canonical SKU' })
  addGlobalItem(@Body() dto: AddGlobalCatalogItemDto) {
    return this.catalogService.addGlobalCatalogItem(dto);
  }

  @Patch('admin/marketplace/catalog/:globalCatalogId')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Edit a canonical global catalog item (super admin only)',
  })
  @ApiResponse({ status: 200, description: 'Global catalog item updated' })
  @ApiResponse({ status: 400, description: 'Invalid category or payload' })
  @ApiResponse({ status: 403, description: 'Super admin role required' })
  @ApiResponse({ status: 404, description: 'Global catalog item not found' })
  updateGlobalItem(
    @Param('globalCatalogId', ParseUUIDPipe) globalCatalogId: string,
    @Body() dto: UpdateGlobalCatalogItemDto,
  ) {
    return this.catalogService.updateGlobalCatalogItem(globalCatalogId, dto);
  }

  @Get('marketplace/catalog')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.CONSUMER, Role.SUPPLIER)
  @ApiOperation({ summary: 'Browse active canonical SKUs in soko_global_catalog' })
  @ApiQuery({ name: 'categoryCode', required: false })
  @ApiQuery({ name: 'q', required: false })
  listGlobalCatalog(
    @Query('categoryCode') categoryCode?: string,
    @Query('q') q?: string,
  ) {
    return this.catalogService.listGlobalCatalog(categoryCode, q);
  }

  @Get('marketplace/merchants')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.CONSUMER, Role.DRIVER, Role.SUPPLIER)
  @ApiOperation({
    summary: 'List open verified Merchants and Manufacturer Suppliers for Sokoni ordering',
  })
  @ApiQuery({ name: 'tier', required: false })
  listMarketplaceMerchants(@Query('tier') tier?: string) {
    return this.catalogService.listMarketplaceMerchants(tier);
  }

  @Get('merchant/catalog/clones')
  @Roles(Role.RETAILER, Role.WHOLESALER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiQuery({ name: 'businessId', required: false })
  @ApiOperation({
    summary: 'List tenant-scoped cloned global catalog items with buying cost and price overrides',
  })
  listMerchantClones(
    @CurrentTenant() tenantContext?: TenantContext,
    @Query('businessId') businessId?: string,
  ) {
    return this.catalogService.listMerchantClones(tenantContext, businessId);
  }

  @Post('marketplace/catalog/clone-standard')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RETAILER, Role.WHOLESALER, Role.SUPER_ADMIN, Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({
    summary: 'Clone global catalog item to a Merchant shelf or Supplier warehouse at 0 stock & 0 TZS',
  })
  @ApiResponse({ status: 200, description: 'Cloned atomically or returned idempotent replay' })
  cloneStandard(
    @Body() dto: CloneStandardCatalogDto,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.catalogService.cloneStandardCatalogItem(dto, tenantContext);
  }

  @Get('marketplace/catalog/intelligent-view')
  @Roles(Role.RETAILER, Role.WHOLESALER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Smart Re-Order catalog view prioritizing low-shelf-stock SKUs under REPEATABLE_READ',
  })
  @ApiQuery({ name: 'wholesalerId', required: true })
  getIntelligentView(
    @Query('wholesalerId', new ParseUUIDPipe()) wholesalerId: string,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.catalogService.getIntelligentCatalogView(wholesalerId, tenantContext);
  }

  @Get('merchant/market-settings')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER)
  @TenantScoped()
  @ApiQuery({ name: 'businessId', required: false })
  @ApiOperation({
    summary: 'Read Merchant free-delivery setting and market publication preferences',
  })
  getMerchantMarketSettings(
    @CurrentTenant() tenantContext?: TenantContext,
    @Query('businessId') businessId?: string,
  ) {
    return this.catalogService.getMerchantMarketSettings(tenantContext, businessId);
  }

  @Patch('merchant/market-settings/free-delivery')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER)
  @TenantScoped()
  @ApiOperation({ summary: 'Enable or disable free delivery for the authenticated Merchant' })
  updateFreeDelivery(
    @Body() dto: UpdateFreeDeliveryDto,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.catalogService.updateFreeDelivery(dto, tenantContext);
  }

  @Post('merchant/market-stock')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER)
  @TenantScoped()
  @ApiOperation({
    summary: 'Publish selected Merchant products and quantities to the market shelf',
  })
  publishMarketStock(
    @Body() dto: PublishMarketStockDto,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.catalogService.publishMarketStock(dto, tenantContext);
  }

  @Get('products/active')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER, Role.CONSUMER, Role.SUPPLIER)
  @ApiOperation({ summary: 'Fetch store-isolated active products for a single Merchant' })
  @ApiQuery({ name: 'businessId', required: true })
  listActiveProducts(@Query('businessId', new ParseUUIDPipe()) businessId: string) {
    return this.catalogService.listActiveProductsByMerchant(businessId);
  }

  @Post('products')
  @Roles(Role.WHOLESALER, Role.RETAILER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiOperation({ summary: 'Create a Merchant SKU inside authenticated Merchant profile' })
  createProduct(
    @Body() dto: CreateMerchantProductDto,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.catalogService.createMerchantProduct(dto, tenantContext);
  }

  @Post('products/:productId/price-tiers')
  @Roles(Role.WHOLESALER, Role.RETAILER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiOperation({
    summary: 'Upsert product volume price tier with Channel Harmony enforcement',
  })
  upsertPriceTier(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: UpsertProductPriceTierDto,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.catalogService.upsertProductPriceTier(productId, dto, tenantContext);
  }

  @Post('products/:productId/custom-units')
  @Roles(Role.WHOLESALER, Role.RETAILER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiOperation({
    summary: 'Upsert custom Tanzanian Merchant unit (Debe, Sado, Dumu) mapped strictly to Quarter-Quanta',
  })
  upsertCustomUnit(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: UpsertCustomMerchantUnitDto,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.catalogService.upsertCustomMerchantUnit(productId, dto, tenantContext);
  }
}
