import { Module } from '@nestjs/common';
import { MerchantTenancyService } from './merchant-tenancy.service';

@Module({
  providers: [MerchantTenancyService],
  exports: [MerchantTenancyService],
})
export class MerchantTenancyModule {
  static readonly phaseStatus = 'IMPLEMENTED_PHASE_2';
}
