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
import { AuditService } from './audit.service';
import { ListManagedOrdersQueryDto, UpdateManagedOrderStatusDto } from './dto/audit.dto';

@ApiTags('Audit & Compliance')
@ApiBearerAuth('bearer')
@Controller('api/v1')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('admin/managed-orders')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List Platform-Managed Order Interceptor audit traces for Super Admin Helpdesk',
  })
  listManagedOrders(@Query() query: ListManagedOrdersQueryDto) {
    return this.auditService.listManagedOrders(query);
  }

  @Patch('admin/managed-orders/:traceId/status')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update Platform-Managed Helpdesk triage status with immutable audit log',
  })
  updateManagedOrderStatus(
    @Param('traceId', new ParseUUIDPipe()) traceId: string,
    @Body() dto: UpdateManagedOrderStatusDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.auditService.updateManagedOrderHelpdeskStatus(traceId, dto, admin.sub);
  }

  @Get('audit/financial-logs')
  @Roles(Role.SUPER_ADMIN, Role.WHOLESALER, Role.RETAILER)
  @TenantScoped()
  @ApiQuery({ name: 'businessId', required: false })
  @ApiOperation({ summary: 'Retrieve immutable financial audit logs scoped to Merchant tenant' })
  listFinancialAuditLogs(
    @CurrentTenant() tenantContext?: TenantContext,
    @Query('businessId') businessId?: string,
  ) {
    return this.auditService.listFinancialAuditLogs(tenantContext, businessId);
  }

  @Get('admin/audit/fraud-alerts')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List 3-strike driver dispute escalations, brute-force locks, and disputed cash ledgers',
  })
  listFraudAlerts() {
    return this.auditService.listFraudAlerts();
  }

  @Get('admin/retention/stats')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Return real PostgreSQL row counts for idempotency keys, cold archive, and outbox queue',
  })
  getRetentionStats() {
    return this.auditService.getRetentionStats();
  }

  @Post('admin/retention/run')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Execute idempotency cleanup and >90d ledger cold archival batch immediately',
  })
  runRetentionCleanup() {
    return this.auditService.runRetentionCleanupNow();
  }
}
