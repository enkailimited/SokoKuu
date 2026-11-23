import { Module } from '@nestjs/common';
import { IdentityModule } from '@modules/01-identity/identity.module';
import {
  AdminMerchantsController,
  AdminMetricsController,
  AdminTenantMapController,
} from './admin-merchants.controller';
import { AdminMerchantsService } from './admin-merchants.service';
import { SalesLeadsController } from './sales-leads.controller';
import { SalesLeadsService } from './sales-leads.service';
import { AdminSystemDocsController } from './admin-docs.controller';
import { AdminStaffController } from './admin-staff.controller';
import { AdminStaffService } from './admin-staff.service';

@Module({
  imports: [IdentityModule],
  controllers: [
    AdminMerchantsController,
    AdminMetricsController,
    AdminTenantMapController,
    SalesLeadsController,
    AdminStaffController,
    AdminSystemDocsController,
  ],
  providers: [AdminMerchantsService, SalesLeadsService, AdminStaffService],
  exports: [AdminMerchantsService, SalesLeadsService, AdminStaffService],
})
export class PlatformAdminModule {
  static readonly phaseStatus = 'IMPLEMENTED_PHASE_4';
}
