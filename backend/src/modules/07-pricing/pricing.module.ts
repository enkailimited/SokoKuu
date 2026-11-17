import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller';
import { PricingRoutingEngine } from './pricing-routing.engine';

@Module({
  controllers: [PricingController],
  providers: [PricingRoutingEngine],
  exports: [PricingRoutingEngine],
})
export class PricingModule {}
