import { Module } from '@nestjs/common';
import { PricingModule } from '@modules/07-pricing/pricing.module';
import { DispatchModule } from '@modules/12-dispatch/dispatch.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PricingModule, DispatchModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
