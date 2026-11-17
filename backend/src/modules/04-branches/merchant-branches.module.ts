import { Module } from '@nestjs/common';
import { GeospatialController } from './geospatial.controller';
import { GeospatialService } from './geospatial.service';

@Module({
  controllers: [GeospatialController],
  providers: [GeospatialService],
  exports: [GeospatialService],
})
export class MerchantBranchesModule {
  static readonly phaseStatus = 'IMPLEMENTED_PHASE_2';
}
