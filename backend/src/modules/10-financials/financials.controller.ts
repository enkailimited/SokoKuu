import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthenticatedUser, TenantContext } from '@common/security/auth.types';
import { CurrentTenant, CurrentUser, Roles, TenantScoped } from '@common/security/decorators';
import { Role } from '@common/security/roles.enum';
import {
  RecordLedgerPaymentDto,
  SettleDriverEodDto,
  VerifyMobileMoneyDto,
} from './dto/financials.dto';
import { FinancialsService } from './financials.service';

@ApiTags('Financials')
@ApiBearerAuth('bearer')
@Controller('api/v1')
export class FinancialsController {
  constructor(private readonly financialsService: FinancialsService) {}

  @Post('financials/ledgers/:orderId/record-payment')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.WHOLESALER, Role.DRIVER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Record full or partial payment collection against CashDeliveryLedger',
  })
  recordPayment(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: RecordLedgerPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.financialsService.recordPartialOrFullPayment(orderId, dto, user, tenantContext);
  }

  @Post('financials/ledgers/:orderId/verify-mobile-money')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.WHOLESALER, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Verify M-PESA / TIGO-PESA transaction reference prior to EOD settlement',
  })
  verifyMobileMoney(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: VerifyMobileMoneyDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.financialsService.verifyMobileMoneyLedger(orderId, dto, user, tenantContext);
  }

  @Get('wholesale/eod/drivers')
  @Roles(Role.WHOLESALER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiQuery({ name: 'businessId', required: false })
  @ApiOperation({
    summary: 'List drivers with unsettled cash, mobile money, partial balances, and exception counts',
  })
  listEodDrivers(
    @CurrentTenant() tenantContext?: TenantContext,
    @Query('businessId') businessId?: string,
  ) {
    return this.financialsService.listDriversForEod(tenantContext, businessId);
  }

  @Post('wholesale/eod-settle/:driverId')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.WHOLESALER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiOperation({
    summary: 'Execute atomic Serializable FOR UPDATE EOD reconciliation batch for a driver',
  })
  @ApiResponse({ status: 200, description: 'EOD reconciliation batch settled' })
  @ApiResponse({
    status: 409,
    description: 'Blocked by unresolved disputes, unverified mobile money, or variance mismatch',
  })
  settleDriverEod(
    @Param('driverId', new ParseUUIDPipe()) driverId: string,
    @Body() dto: SettleDriverEodDto,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.financialsService.settleDriverEod(driverId, dto, user, tenantContext);
  }

  @Get('hybrid/analytics/export-csv')
  @Roles(Role.WHOLESALER, Role.RETAILER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiQuery({ name: 'businessId', required: false })
  @ApiOperation({
    summary: 'Stream UTF-8 BOM Swahili financial ledger CSV with formula-injection neutralization',
  })
  async exportSwahiliCsv(
    @Res() res: Response,
    @CurrentTenant() tenantContext?: TenantContext,
    @Query('businessId') businessId?: string,
  ) {
    const csv = await this.financialsService.generateSwahiliAnalyticsCsv(
      tenantContext,
      businessId,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sokokuu-mauzo.csv"');
    res.status(HttpStatus.OK).send(csv);
  }

  @Get('hybrid/analytics/:businessId/daily-revenue')
  @Roles(Role.WHOLESALER, Role.RETAILER, Role.SUPER_ADMIN)
  @TenantScoped()
  @ApiOperation({
    summary: 'Aggregate B2B wholesale vs B2C retail daily revenue and payment balances in TZS',
  })
  getDailyRevenue(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @CurrentTenant() tenantContext?: TenantContext,
  ) {
    return this.financialsService.getDailyRevenueAnalytics(businessId, tenantContext);
  }
}
