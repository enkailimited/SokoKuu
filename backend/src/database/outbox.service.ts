import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface OutboxEnqueueInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  routingKey: string;
  payload: Prisma.InputJsonValue;
  correlationId?: string;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async enqueue(
    input: OutboxEnqueueInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    const data: Prisma.DomainOutboxEventCreateInput = {
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      routingKey: input.routingKey,
      payload: input.payload,
      correlationId: input.correlationId ?? null,
      status: 'PENDING',
    };

    const write = (client: Prisma.TransactionClient | PrismaService) =>
      client.domainOutboxEvent.create({
        data,
        select: { id: true },
      });

    if (!tx) {
      return write(this.prismaService);
    }

    try {
      return await write(tx);
    } catch (error) {
      if (!this.isClosedTransactionError(error)) {
        throw error;
      }
      // The supplied transaction client can outlive its callback when a request
      // is retried or the app is shutting down. Keep the outbox write durable
      // by retrying once on the root client instead of losing the event.
      this.logger.warn(
        `Outbox enqueue used a closed transaction for ${input.eventType}; retrying on the root Prisma client.`,
      );
      return write(this.prismaService);
    }
  }

  private isClosedTransactionError(error: unknown): boolean {
    const code = (error as { code?: string } | null)?.code;
    const message = error instanceof Error ? error.message : String(error ?? '');
    return (
      code === 'P2028' ||
      /transaction (api error|not found)|transaction already closed|old closed transaction|expired transaction|obtained before disconnecting/i.test(
        message,
      )
    );
  }
}
