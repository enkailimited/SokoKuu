import { Module } from '@nestjs/common';
import { AdminPricingTemplatesController } from './admin-pricing-templates.controller';
import { PricingController } from './pricing.controller';
import { PricingRoutingEngine } from './pricing-routing.engine';
import { PricingTemplateService } from './pricing-template.service';

@Module({
  controllers: [PricingController, AdminPricingTemplatesController],
  providers: [PricingRoutingEngine, PricingTemplateService],
  exports: [PricingRoutingEngine, PricingTemplateService],
})
export class PricingModule {}
