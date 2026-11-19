import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationInboxController } from './notification-inbox.controller';
import { NotificationsController } from './notifications.controller';
import { OutboundSmsService } from './outbound-sms.service';
import { OutboxRelayWorker } from './outbox-relay.worker';
import { RealtimeGateway } from './realtime.gateway';
import { WebPushDispatchService } from './web-push.service';
import { WebPushController } from './web-push.controller';
import { UserNotificationService } from './user-notification.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET') ?? 'fallback_jwt_access_secret_key_32_chars_long',
        signOptions: {
          expiresIn: (config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as any,
        },
      }),
    }),
  ],
  controllers: [NotificationsController, WebPushController, NotificationInboxController],
  providers: [
    OutboundSmsService,
    OutboxRelayWorker,
    RealtimeGateway,
    WebPushDispatchService,
    UserNotificationService,
  ],
  exports: [
    OutboundSmsService,
    OutboxRelayWorker,
    RealtimeGateway,
    WebPushDispatchService,
    UserNotificationService,
  ],
})
export class NotificationsModule {}
