import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DispatchModule } from '@modules/12-dispatch/dispatch.module';
import { NotificationsModule } from '@modules/13-notifications/notifications.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { DisputeAlertConsumer } from './dispute-alert.consumer';
import { RetentionCronService } from './retention-cron.service';

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule, DispatchModule],
  controllers: [AuditController],
  providers: [AuditService, DisputeAlertConsumer, RetentionCronService],
  exports: [AuditService, DisputeAlertConsumer, RetentionCronService],
})
export class AuditModule {}
