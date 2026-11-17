import { Body, Controller, Get, Headers, HttpCode, HttpStatus, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { CurrentTenant, CurrentUser, Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { CatalogService } from '@modules/05-catalog/catalog.service';
import { CreateOrderRequestDto } from '@modules/09-orders/dto/orders.dto';
import { OrderReceiptResponse, OrdersService } from '@modules/09-orders/orders.service';

@ApiTags('Procurement')
@ApiBearerAuth('bearer')
@Controller('api/v1/procurement')
export class ProcurementController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly ordersService: OrdersService,
  ) {}

  @Get('reorder-suggestions')
  @Roles(Role.RETAILER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Fetch intelligent low-stock B2B procurement reorder suggestions from a Wholesaler',
  })
  @ApiQuery({ name: 'wholesalerId', required: true })
  getReorderSuggestions(
    @Query('wholesalerId', new ParseUUIDPipe()) wholesalerId: string,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.catalogService.getIntelligentCatalogView(wholesalerId, tenantContext);
  }

  @Post('purchase-requests')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.RETAILER, Role.SUPER_ADMIN)
  @ApiHeader({ name: 'X-Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Submit store-isolated B2B replenishment purchase request with idempotency & atomic stock reservation',
  })
  submitPurchaseRequest(
    @Body() dto: CreateOrderRequestDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ): Promise<OrderReceiptResponse> {
    return this.ordersService.createOrder(dto, idempotencyKey, user, tenantContext);
  }
}
