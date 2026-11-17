import { Module } from '@nestjs/common';
import { PricingModule } from '@modules/07-pricing/pricing.module';
import { NotificationsModule } from '@modules/13-notifications/notifications.module';
import { NextSmsWebhookController } from './nextsms-webhook.controller';
import { NextSmsWebhookService } from './nextsms-webhook.service';

@Module({
  imports: [PricingModule, NotificationsModule],
  controllers: [NextSmsWebhookController],
  providers: [NextSmsWebhookService],
  exports: [NextSmsWebhookService],
})
export class WebhooksModule {}
