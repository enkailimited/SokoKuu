import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';

export interface OutboundSmsRequest {
  recipientPhoneE164: string;
  messageBody: string;
  outboxEventId?: string;
  maxAttempts?: number;
}

export interface NextSmsSendResult {
  smsLogId: string;
  status: 'SENT' | 'FAILED' | 'DEAD_LETTER';
  attemptCount: number;
  providerMessageId: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
}

@Injectable()
export class OutboundSmsService {
  private readonly logger = new Logger(OutboundSmsService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async queueAndDispatchSms(
    input: OutboundSmsRequest,
    tx?: Prisma.TransactionClient,
  ): Promise<{ smsLogId: string; status: string }> {
    const client = tx ?? this.prismaService;
    const boundedBody = input.messageBody.slice(0, 160);

    const created = await client.smsDeliveryLog.create({
      data: {
        outboxEventId: input.outboxEventId ?? null,
        recipientPhoneE164: input.recipientPhoneE164,
        messageBody: boundedBody,
        provider: 'NEXTSMS',
        status: 'QUEUED',
        attemptCount: 0,
        maxAttempts: input.maxAttempts ?? 3,
      },
      select: { id: true, status: true },
    });

    if (!tx) {
      const dispatched = await this.dispatchSmsLog(created.id);
      return { smsLogId: dispatched.smsLogId, status: dispatched.status };
    }

    return { smsLogId: created.id, status: created.status };
  }

  async dispatchSmsLog(smsLogId: string): Promise<NextSmsSendResult> {
    const log = await this.prismaService.smsDeliveryLog.findUnique({
      where: { id: smsLogId },
    });

    if (!log) {
      throw new Error(`SmsDeliveryLog ${smsLogId} not found.`);
    }

    const nextAttempt = log.attemptCount + 1;
    const baseUrl =
      this.configService.get<string>('NEXTSMS_API_BASE_URL') ??
      'https://messaging-service.co.tz';
    const username = this.configService.get<string>('NEXTSMS_USERNAME');
    const password = this.configService.get<string>('NEXTSMS_PASSWORD');
    const senderId = this.configService.get<string>('NEXTSMS_SENDER_ID') ?? 'SOKOKUU';

    const msisdn = log.recipientPhoneE164.replace(/^\+/, '');
    const endpoint = `${baseUrl.replace(/\/$/, '')}/api/sms/v1/text/single`;

    try {
      if (!username || !password) {
        throw new Error('NEXTSMS_CREDENTIALS_NOT_CONFIGURED');
      }

      const basicAuth = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({
          from: senderId,
          to: msisdn,
          text: log.messageBody,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        throw new Error(`NEXTSMS_HTTP_${response.status}`);
      }

      const body = (await response.json().catch(() => ({}))) as {
        messages?: Array<{ messageId?: string }>;
      };
      const providerMessageId = body.messages?.[0]?.messageId ?? `nextsms-${smsLogId.slice(0, 8)}`;

      await this.prismaService.smsDeliveryLog.update({
        where: { id: smsLogId },
        data: {
          status: 'SENT',
          attemptCount: nextAttempt,
          providerMessageId,
          sentAt: new Date(),
          nextRetryAt: null,
          lastError: null,
        },
      });

      if (log.outboxEventId) {
        await this.prismaService.domainOutboxEvent.update({
          where: { id: log.outboxEventId },
          data: {
            status: OutboxStatus.PUBLISHED,
            publishedAt: new Date(),
            lastError: null,
          },
        });
      }

      this.logger.log(
        `[SOKOKUU-NEXTSMS-SENT] smsLogId=${smsLogId} recipient=${msisdn.slice(0, 6)}**** attempt=${nextAttempt}`,
      );

      return {
        smsLogId,
        status: 'SENT',
        attemptCount: nextAttempt,
        providerMessageId,
        nextRetryAt: null,
        lastError: null,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'NEXTSMS_DISPATCH_ERROR';
      const isDeadLetter = nextAttempt >= log.maxAttempts;
      const backoffSeconds = 30 * Math.pow(2, Math.max(0, nextAttempt - 1));
      const nextRetryAt = isDeadLetter
        ? null
        : new Date(Date.now() + backoffSeconds * 1000);
      const nextStatus = isDeadLetter ? 'DEAD_LETTER' : 'FAILED';

      await this.prismaService.smsDeliveryLog.update({
        where: { id: smsLogId },
        data: {
          status: nextStatus,
          attemptCount: nextAttempt,
          nextRetryAt,
          lastError: errorMessage,
        },
      });

      if (log.outboxEventId) {
        await this.prismaService.domainOutboxEvent.update({
          where: { id: log.outboxEventId },
          data: {
            status: isDeadLetter ? OutboxStatus.DEAD_LETTER : OutboxStatus.FAILED,
            retryCount: nextAttempt,
            nextRetryAt,
            lastError: errorMessage,
          },
        });
      }

      this.logger.warn(
        `[SOKOKUU-NEXTSMS-RETRY] smsLogId=${smsLogId} status=${nextStatus} attempt=${nextAttempt}/${log.maxAttempts} reason=${errorMessage}`,
      );

      return {
        smsLogId,
        status: nextStatus,
        attemptCount: nextAttempt,
        providerMessageId: null,
        nextRetryAt: nextRetryAt?.toISOString() ?? null,
        lastError: errorMessage,
      };
    }
  }

  async processDueRetries(): Promise<{ processed: number; sent: number; deadLettered: number }> {
    const dueLogs = await this.prismaService.smsDeliveryLog.findMany({
      where: {
        status: 'FAILED',
        nextRetryAt: { lte: new Date() },
      },
      orderBy: { nextRetryAt: 'asc' },
      take: 25,
      select: { id: true },
    });

    let sent = 0;
    let deadLettered = 0;

    for (const row of dueLogs) {
      const result = await this.dispatchSmsLog(row.id);
      if (result.status === 'SENT') sent += 1;
      if (result.status === 'DEAD_LETTER') deadLettered += 1;
    }

    return {
      processed: dueLogs.length,
      sent,
      deadLettered,
    };
  }

  async listSmsDeliveryLogs(status?: string) {
    const logs = await this.prismaService.smsDeliveryLog.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      count: logs.length,
      logs: logs.map((l) => ({
        id: l.id,
        outboxEventId: l.outboxEventId,
        recipientPhoneE164: l.recipientPhoneE164,
        status: l.status,
        attemptCount: l.attemptCount,
        maxAttempts: l.maxAttempts,
        nextRetryAt: l.nextRetryAt?.toISOString() ?? null,
        lastError: l.lastError,
        sentAt: l.sentAt?.toISOString() ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }
}
