import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { CurrentTenant, CurrentUser, Roles, TenantScoped } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import {
  PublishSupplierListingDto,
  SupplierExternalPurchaseReceiptDto,
  SupplierStockInDto,
  ToggleSupplierAdminReceiveDto,
  UpdateSupplierDeliverySettingsDto,
} from './dto/supplier.dto';
import { SupplierService } from './supplier.service';

@ApiTags('Supplier')
@ApiBearerAuth('bearer')
@Controller('api/v1')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Get('supplier/inventory')
  @Roles(Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({ summary: 'List server-derived Supplier warehouse stock and unit conversions' })
  listInventory(@CurrentTenant() tenantContext?: TenantContext) {
    return this.supplierService.listInventory(tenantContext);
  }

  @Post('supplier/inventory/stock-in')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({ summary: 'Record factory or bulk warehouse stock-in as immutable Quarter-Quanta' })
  stockIn(
    @Body() dto: SupplierStockInDto,
    @CurrentTenant() tenantContext: TenantContext | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierService.recordStockIn(dto, tenantContext, user.sub);
  }

  @Post('supplier/purchases/external-receipt')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({
    summary: 'Record a Supplier manual purchase receipt and hydrate warehouse stock when goods arrive',
  })
  recordExternalPurchaseReceipt(
    @Body() dto: SupplierExternalPurchaseReceiptDto,
    @CurrentTenant() tenantContext: TenantContext | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierService.recordExternalPurchaseReceipt(dto, tenantContext, user.sub);
  }

  @Patch('supplier/admin-receive')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({
    summary: 'Grant or revoke explicit consent for Super Admin helpdesk order receiving',
  })
  setAllowAdminReceive(
    @Body() dto: ToggleSupplierAdminReceiveDto,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.supplierService.setAllowAdminReceive(dto, tenantContext);
  }

  @Post('supplier/catalog/publish')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({ summary: 'Publish or update a Supplier bulk listing to the B2B Sokoni market' })
  publishListing(
    @Body() dto: PublishSupplierListingDto,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.supplierService.publishListing(dto, tenantContext);
  }

  @Get('marketplace/suppliers/catalog')
  @Roles(Role.WHOLESALER, Role.RETAILER, Role.SUPPLIER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Browse published Supplier bulk offerings, MOQs, stock and Free Delivery badges',
  })
  listSupplierMarketplace() {
    return this.supplierService.listSupplierMarketplace();
  }

  @Get('supplier/delivery-settings')
  @Roles(Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({ summary: 'Read Supplier B2B delivery policy' })
  getDeliverySettings(@CurrentTenant() tenantContext?: TenantContext) {
    return this.supplierService.getDeliverySettings(tenantContext);
  }

  @Patch('supplier/delivery-settings')
  @Roles(Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({ summary: 'Configure Supplier Free Delivery threshold and standard fee' })
  updateDeliverySettings(
    @Body() dto: UpdateSupplierDeliverySettingsDto,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.supplierService.updateDeliverySettings(dto, tenantContext);
  }

  @Get('supplier/orders')
  @Roles(Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({ summary: 'List incoming Wholesaler B2B orders for the Supplier warehouse' })
  listIncomingOrders(@CurrentTenant() tenantContext?: TenantContext) {
    return this.supplierService.listIncomingOrders(tenantContext);
  }

  @Get('supplier/reports/summary')
  @Roles(Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({ summary: 'Supplier revenue, fulfilment, free-delivery and warehouse KPIs' })
  getReportsSummary(@CurrentTenant() tenantContext?: TenantContext) {
    return this.supplierService.getReportsSummary(tenantContext);
  }

  @Get('supplier/reports/export-csv')
  @Roles(Role.SUPPLIER)
  @TenantScoped()
  @ApiOperation({
    summary: 'Download UTF-8 BOM Swahili Supplier CSV with formula-injection neutralization',
  })
  async exportCsv(@Res() res: Response, @CurrentTenant() tenantContext?: TenantContext) {
    const csv = await this.supplierService.generateSwahiliCsv(tenantContext);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sokokuu-supplier-ripoti.csv"');
    res.status(HttpStatus.OK).send(csv);
  }
}
