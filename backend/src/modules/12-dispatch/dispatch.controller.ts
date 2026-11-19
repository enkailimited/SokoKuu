import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { CurrentTenant, CurrentUser, Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { DispatchOrderDto } from './dto/dispatch.dto';
import { DispatchService } from './dispatch.service';

@ApiTags('Dispatch')
@ApiBearerAuth('bearer')
@Controller('api/v1')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Post('orders/:orderId/dispatch')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.WHOLESALER, Role.RETAILER, Role.SUPPLIER, Role.DRIVER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Transition PLACED order to DISPATCHED and allocate salted Argon2id Buyer & Driver PINs',
  })
  @ApiResponse({ status: 200, description: 'Order dispatched and Dual-PINs generated once' })
  @ApiResponse({ status: 409, description: 'Invalid order transition' })
  dispatchOrder(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: DispatchOrderDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.dispatchService.dispatchOrderAndAllocatePins(orderId, dto, user, tenantContext);
  }

  @Post('orders/:orderId/driver-arrival-qr')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DRIVER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Issue time-bounded HMAC-signed single-use SKQR-* arrival verification token',
  })
  @ApiResponse({ status: 200, description: 'Single-use signed QR token issued' })
  @ApiResponse({ status: 409, description: 'QR token already consumed' })
  issueArrivalQr(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatchService.issueDriverArrivalQr(orderId, user);
  }

  @Get('dispatch/driver-queue')
  @Roles(Role.DRIVER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Fetch active delivery queue for authenticated Driver' })
  getDriverQueue(@CurrentUser() user: AuthenticatedUser) {
    return this.dispatchService.getDriverQueue(user);
  }

  @Get('dispatch/available-drivers')
  @Roles(Role.WHOLESALER, Role.RETAILER, Role.SUPPLIER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List registered drivers eligible for order dispatch assignment' })
  listAvailableDrivers() {
    return this.dispatchService.listAvailableDrivers();
  }
}
