import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@database/prisma.service';
import { OutboundSmsService } from '@modules/13-notifications/outbound-sms.service';
import { RealtimeGateway } from '@modules/13-notifications/realtime.gateway';

@Injectable()
export class DisputeAlertConsumer implements OnModuleInit {
  private readonly logger = new Logger(DisputeAlertConsumer.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly outboundSmsService: OutboundSmsService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    this.logger.log('DisputeAlertConsumer initialized for 3-strike delivery fraud detection.');
  }

  async evaluateDriverDisputes(driverUserId: string): Promise<{ recentDisputes: number; flagged: boolean }> {
    const rolling24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const disputeCount = await this.prismaService.cashDeliveryLedger.count({
      where: {
        driverUserId,
        verificationStatus: 'DISPUTED',
        updatedAt: { gte: rolling24hAgo },
      },
    });

    if (disputeCount >= 3) {
      await this.prismaService.securityAuditLog.create({
        data: {
          userId: driverUserId,
          eventType: 'DRIVER_3_STRIKE_AUDIT_FLAGGED',
          details: {
            driverUserId,
            recentDisputes: disputeCount,
            windowHours: 24,
          },
        },
      });

      const alertPhone =
        this.configService.get<string>('SECURITY_ADMIN_ALERT_PHONE') ?? '+255688000000';
      const warningMsg = `SokoKuu FRAUD ALERT: Driver ${driverUserId.slice(0, 8)} has logged ${disputeCount} DISPUTED cash variances in 24h!`;

      await this.outboundSmsService.queueAndDispatchSms({
        recipientPhoneE164: alertPhone,
        messageBody: warningMsg,
      });

      this.realtimeGateway.broadcastAdminAlert({
        event: 'DRIVER_3_STRIKE_FRAUD_FLAGGED',
        driverUserId,
        recentDisputes: disputeCount,
        timestamp: new Date().toISOString(),
      });

      return { recentDisputes: disputeCount, flagged: true };
    }

    return { recentDisputes: disputeCount, flagged: false };
  }
}
