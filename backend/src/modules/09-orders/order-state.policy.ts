import { ConflictException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ['DISPATCHED', 'CANCELLED', 'DISPUTED'],
  DISPATCHED: ['DELIVERED', 'CANCELLED', 'DISPUTED'],
  DISPUTED: ['CANCELLED', 'DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export function assertValidOrderTransition(fromStatus: OrderStatus, toStatus: OrderStatus): void {
  const allowed = ALLOWED_ORDER_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new ConflictException(
      `INVALID_ORDER_TRANSITION: Cannot transition order from ${fromStatus} to ${toStatus}.`,
    );
  }
}
