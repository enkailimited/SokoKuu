import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CentralizedUnitsPricingController } from './centralized-units-pricing.controller';
import { CentralizedUnitsPricingService } from './centralized-units-pricing.service';

@Module({
  controllers: [CatalogController, CentralizedUnitsPricingController],
  providers: [CatalogService, CentralizedUnitsPricingService],
  exports: [CatalogService, CentralizedUnitsPricingService],
})
export class CatalogModule {
  static readonly phaseStatus = 'IMPLEMENTED_PHASE_3';
}
