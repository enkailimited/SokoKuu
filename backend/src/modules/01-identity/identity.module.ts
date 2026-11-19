import { Module } from '@nestjs/common';
import { NotificationsModule } from '@modules/13-notifications/notifications.module';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

@Module({
  imports: [NotificationsModule],
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {
  static readonly phaseStatus = 'IMPLEMENTED_PHASE_2';
}
