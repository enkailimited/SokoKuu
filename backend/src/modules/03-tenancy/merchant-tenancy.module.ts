import { Module } from '@nestjs/common';
import { MerchantProfileLocationController } from './merchant-profile-location.controller';
import { MerchantTenancyService } from './merchant-tenancy.service';

@Module({
  controllers: [MerchantProfileLocationController],
  providers: [MerchantTenancyService],
  exports: [MerchantTenancyService],
})
export class MerchantTenancyModule {
  static readonly phaseStatus = 'IMPLEMENTED_PHASE_2';
}
