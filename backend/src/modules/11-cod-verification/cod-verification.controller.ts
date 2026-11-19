import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthenticatedUser } from '@common/security/auth.types';
import { CurrentUser, Roles } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import { CodVerificationService } from './cod-verification.service';
import {
  BuyerConfirmPinDto,
  DriverConfirmPinDto,
  IsolatedBuyerPinDto,
  IsolatedDriverPinDto,
  RetailerQrScanDto,
  VerifyDoorstepQrDto,
} from './dto/cod-verification.dto';

@ApiTags('CoD Verification')
@ApiBearerAuth('bearer')
@Controller('api/v1')
export class CodVerificationController {
  constructor(private readonly codService: CodVerificationService) {}

  @Post('ledgers/:orderId/buyer-confirm')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RETAILER, Role.WHOLESALER, Role.CONSUMER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Submit Buyer confirmation PIN for Cash-on-Delivery ledger' })
  confirmBuyer(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: BuyerConfirmPinDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.codService.confirmBuyerPin(orderId, dto, user, req.ip);
  }

  @Post('ledgers/:orderId/driver-confirm')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DRIVER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Submit Driver confirmation PIN and exact collected TZS cash amount',
  })
  confirmDriver(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: DriverConfirmPinDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.codService.confirmDriverPin(orderId, dto, user, req.ip);
  }

  @Post('orders/verify-doorstep-qr')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DRIVER, Role.RETAILER, Role.WHOLESALER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Verify time-bounded HMAC QR token + Dual-PIN + cash match atomically under SERIALIZABLE',
  })
  @ApiResponse({ status: 200, description: 'Delivered and ledger reconciled' })
  @ApiResponse({ status: 409, description: 'QR token already consumed or cash mismatch' })
  @ApiResponse({ status: 410, description: 'QR token expired' })
  verifyDoorstepQr(
    @Body() dto: VerifyDoorstepQrDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.codService.verifyDoorstepQr(dto, user, req.ip);
  }

  @Post('orders/reconcile/retailer-qr-scan')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RETAILER, Role.WHOLESALER, Role.CONSUMER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Device-isolated Buyer QR scan triggering Driver PIN terminal outbox signal',
  })
  retailerQrScan(@Body() dto: RetailerQrScanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.codService.retailerQrScan(dto, user);
  }

  @Post('orders/reconcile/buyer-pin')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.RETAILER, Role.WHOLESALER, Role.CONSUMER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Device-isolated Buyer PIN confirmation' })
  isolatedBuyerPin(
    @Body() dto: IsolatedBuyerPinDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.codService.isolatedBuyerPin(dto, user, req.ip);
  }

  @Post('orders/reconcile/driver-pin')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DRIVER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Device-isolated Driver PIN & collected cash confirmation' })
  isolatedDriverPin(
    @Body() dto: IsolatedDriverPinDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.codService.isolatedDriverPin(dto, user, req.ip);
  }
}
