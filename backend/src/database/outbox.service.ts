import { Injectable } from '@nestjs/common';
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
  constructor(private readonly prismaService: PrismaService) {}

  async enqueue(
    input: OutboxEnqueueInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    const client = tx ?? this.prismaService;
    return client.domainOutboxEvent.create({
      data: {
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        routingKey: input.routingKey,
        payload: input.payload,
        correlationId: input.correlationId ?? null,
        status: 'PENDING',
      },
      select: { id: true },
    });
  }
}
