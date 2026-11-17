import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { CurrentTenant, CurrentUser, Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { CancelOrderDto, CreateOrderRequestDto } from './dto/orders.dto';
import { OrderReceiptResponse, OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth('bearer')
@Controller('api/v1')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

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

  @Post('orders/:orderId/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RETAILER, Role.CONSUMER, Role.WHOLESALER, Role.DRIVER, Role.SUPER_ADMIN)
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
  @Roles(Role.RETAILER, Role.CONSUMER, Role.WHOLESALER, Role.DRIVER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Retrieve tenant-scoped order details and cash ledger summary' })
  getOrderDetails(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.ordersService.getOrderDetails(orderId, user, tenantContext);
  }
}
