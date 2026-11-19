import './test-env.setup';
import { OutboxService } from '@database/outbox.service';
import { PrismaService } from '@database/prisma.service';

describe('OutboxService stale transaction resilience', () => {
  const input = {
    aggregateType: 'Order',
    aggregateId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    eventType: 'ManagedOrderRoutedEvent',
    routingKey: 'admin.managed.order_routed',
    payload: { orderRef: 'DNAN4S8D' },
  };

  const createPrisma = (rootCreate: jest.Mock) =>
    ({ domainOutboxEvent: { create: rootCreate } } as unknown as PrismaService);

  it('writes through the supplied transaction client when it is still open', async () => {
    const txCreate = jest.fn().mockResolvedValue({ id: 'tx-event' });
    const rootCreate = jest.fn().mockResolvedValue({ id: 'root-event' });
    const service = new OutboxService(createPrisma(rootCreate));

    const result = await service.enqueue(input, {
      domainOutboxEvent: { create: txCreate },
    } as any);

    expect(result).toEqual({ id: 'tx-event' });
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(rootCreate).not.toHaveBeenCalled();
  });

  it('retries once on the root client when the transaction is stale/closed', async () => {
    const staleError = new Error(
      'Invalid `client.domainOutboxEvent.create()` invocation ... Transaction API error: ' +
        'Transaction not found. Transaction ID is invalid, refers to an old closed transaction ' +
        'Prisma doesn\'t have information about anymore, or was obtained before disconnecting.',
    );
    const txCreate = jest.fn().mockRejectedValue(staleError);
    const rootCreate = jest.fn().mockResolvedValue({ id: 'root-event' });
    const service = new OutboxService(createPrisma(rootCreate));

    const result = await service.enqueue(input, {
      domainOutboxEvent: { create: txCreate },
    } as any);

    expect(result).toEqual({ id: 'root-event' });
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(rootCreate).toHaveBeenCalledTimes(1);
    expect(rootCreate.mock.calls[0][0].data.eventType).toBe(input.eventType);
  });

  it('retries once on the root client for Prisma P2028 transaction timeouts', async () => {
    const timeoutError = Object.assign(new Error('Transaction timed out'), { code: 'P2028' });
    const txCreate = jest.fn().mockRejectedValue(timeoutError);
    const rootCreate = jest.fn().mockResolvedValue({ id: 'root-event-p2028' });
    const service = new OutboxService(createPrisma(rootCreate));

    const result = await service.enqueue(input, {
      domainOutboxEvent: { create: txCreate },
    } as any);

    expect(result).toEqual({ id: 'root-event-p2028' });
    expect(rootCreate).toHaveBeenCalledTimes(1);
  });

  it('does not swallow unrelated database errors', async () => {
    const validationError = new Error('canonicalSku is required');
    const txCreate = jest.fn().mockRejectedValue(validationError);
    const rootCreate = jest.fn().mockResolvedValue({ id: 'root-event' });
    const service = new OutboxService(createPrisma(rootCreate));

    await expect(
      service.enqueue(input, {
        domainOutboxEvent: { create: txCreate },
      } as any),
    ).rejects.toThrow('canonicalSku is required');
    expect(rootCreate).not.toHaveBeenCalled();
  });

  it('writes directly on the root client when no transaction is supplied', async () => {
    const rootCreate = jest.fn().mockResolvedValue({ id: 'root-only' });
    const service = new OutboxService(createPrisma(rootCreate));

    const result = await service.enqueue(input);

    expect(result).toEqual({ id: 'root-only' });
    expect(rootCreate).toHaveBeenCalledTimes(1);
  });
});
