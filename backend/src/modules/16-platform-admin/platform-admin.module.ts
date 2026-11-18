import { Module } from '@nestjs/common';
import {
  AdminMerchantsController,
  AdminMetricsController,
  AdminTenantMapController,
} from './admin-merchants.controller';
import { AdminMerchantsService } from './admin-merchants.service';
import { SalesLeadsController } from './sales-leads.controller';
import { SalesLeadsService } from './sales-leads.service';
import { AdminSystemDocsController } from './admin-docs.controller';

@Module({
  controllers: [
    AdminMerchantsController,
    AdminMetricsController,
    AdminTenantMapController,
    SalesLeadsController,
    AdminSystemDocsController,
  ],
  providers: [AdminMerchantsService, SalesLeadsService],
  exports: [AdminMerchantsService, SalesLeadsService],
})
export class PlatformAdminModule {
  static readonly phaseStatus = 'IMPLEMENTED_PHASE_4';
}
