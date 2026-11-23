import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { CurrentTenant, CurrentUser, Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import {
  CancelOrderDto,
  CreateOrderRequestDto,
  SubmitBatchOrdersDto,
} from './dto/orders.dto';
import { OrderReceiptResponse, OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth('bearer')
@Controller('api/v1')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('orders')
  @Roles(Role.RETAILER, Role.CONSUMER, Role.WHOLESALER, Role.DRIVER, Role.SUPPLIER, Role.SUPER_ADMIN)
  @ApiQuery({ name: 'scope', required: false, enum: ['buying', 'selling', 'all'] })
  @ApiOperation({
    summary: 'List orders scoped to authenticated buyer, seller Merchant, or Super Admin',
  })
  listOrdersAlias(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
    @Query('scope') scope?: 'buying' | 'selling' | 'all',
  ) {
    return this.ordersService.listMyOrders(user, tenantContext, scope);
  }

  @Get('orders/my-orders')
  @Roles(Role.RETAILER, Role.CONSUMER, Role.WHOLESALER, Role.DRIVER, Role.SUPPLIER, Role.SUPER_ADMIN)
  @ApiQuery({ name: 'scope', required: false, enum: ['buying', 'selling', 'all'] })
  @ApiOperation({
    summary: 'List orders scoped to authenticated buyer, seller Merchant, or Super Admin',
  })
  listMyOrders(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
    @Query('scope') scope?: 'buying' | 'selling' | 'all',
  ) {
    return this.ordersService.listMyOrders(user, tenantContext, scope);
  }

  @Post('orders/request')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.RETAILER, Role.CONSUMER, Role.WHOLESALER, Role.SUPER_ADMIN)
  @ApiHeader({ name: 'X-Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Submit store-isolated order request with idempotency, Quarter-Quanta lock, and Managed Interceptor',
  })
  @ApiResponse({ status: 201, description: 'Order placed or replayed idempotently' })
  @ApiResponse({ status: 409, description: 'Insufficient inventory or idempotency payload mismatch' })
  createOrderRequest(
    @Body() dto: CreateOrderRequestDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ): Promise<OrderReceiptResponse> {
    return this.ordersService.createOrder(dto, idempotencyKey, user, tenantContext);
  }

  @Post('marketplace/orders/submit-request')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.RETAILER, Role.CONSUMER, Role.WHOLESALER, Role.SUPER_ADMIN)
  @ApiHeader({ name: 'X-Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Marketplace Managed-Order Interceptor submission endpoint',
  })
  submitMarketplaceOrderRequest(
    @Body() dto: CreateOrderRequestDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ): Promise<OrderReceiptResponse> {
    return this.ordersService.createOrder(dto, idempotencyKey, user, tenantContext);
  }

  @Post('marketplace/orders/submit-batch')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.RETAILER, Role.CONSUMER, Role.WHOLESALER, Role.SUPER_ADMIN)
  @ApiHeader({ name: 'X-Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Submit instant or scheduled multi-Merchant orders with per-store isolation',
  })
  @ApiResponse({ status: 201, description: 'Batch orders placed cleanly' })
  submitBatchOrders(
    @Body() dto: SubmitBatchOrdersDto,
    @Headers('x-idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.ordersService.submitBatchOrders(dto, idempotencyKey, user, tenantContext);
  }

  @Post('orders/:orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RETAILER, Role.CONSUMER, Role.WHOLESALER, Role.DRIVER, Role.SUPPLIER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Cancel PLACED or DISPATCHED order atomically and release reserved Quarter-Quanta',
  })
  @ApiResponse({ status: 200, description: 'Order cancelled and inventory restored' })
  @ApiResponse({ status: 409, description: 'Invalid state transition (e.g., DELIVERED -> CANCELLED)' })
  cancelOrder(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: CancelOrderDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.ordersService.cancelOrder(orderId, dto, user, tenantContext);
  }

  @Get('orders/:orderId')
  @Roles(Role.RETAILER, Role.CONSUMER, Role.WHOLESALER, Role.DRIVER, Role.SUPPLIER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Retrieve tenant-scoped order details and cash ledger summary' })
  getOrderDetails(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.ordersService.getOrderDetails(orderId, user, tenantContext);
  }

  @Get('wholesale/orders/zone-schedule')
  @Roles(Role.WHOLESALER, Role.SUPPLIER, Role.SUPER_ADMIN)
  @ApiQuery({ name: 'date', required: true, example: '2026-11-21' })
  @ApiOperation({
    summary: 'Group placed/scheduled orders for a seller by delivery zone and scheduled date',
  })
  getZoneSchedule(
    @Query('date') date: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Tarehe ya ratiba lazima iwe YYYY-MM-DD.');
    }
    return this.ordersService.getZoneSchedule(date, user, tenantContext);
  }

  @Post('wholesale/orders/dispatch-zone-batch')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.WHOLESALER, Role.SUPPLIER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Dispatch all scheduled/placed orders in a geographic zone for a date to a driver',
  })
  dispatchZoneBatch(
    @Body() body: { date: string; deliveryZoneWard: string; driverUserId?: string },
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    if (!body?.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      throw new BadRequestException('Tarehe ya ratiba lazima iwe YYYY-MM-DD.');
    }
    if (!body?.deliveryZoneWard || !String(body.deliveryZoneWard).trim()) {
      throw new BadRequestException('Eneo (ward/zone) linahitajika.');
    }
    return this.ordersService.dispatchZoneBatch(
      {
        date: body.date,
        deliveryZoneWard: String(body.deliveryZoneWard).trim(),
        driverUserId: body.driverUserId,
      },
      user,
      tenantContext,
    );
  }
}
