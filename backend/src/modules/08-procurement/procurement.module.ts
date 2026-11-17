import { Module } from '@nestjs/common';
import { CatalogModule } from '@modules/05-catalog/catalog.module';
import { OrdersModule } from '@modules/09-orders/orders.module';
import { ProcurementController } from './procurement.controller';

@Module({
  imports: [CatalogModule, OrdersModule],
  controllers: [ProcurementController],
})
export class ProcurementModule {}
