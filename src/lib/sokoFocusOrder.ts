import { useEffect } from 'react';

/**
 * Notification deep-link target. A bell click carries the exact order the
 * operator must act on, so the destination view can scroll that order row into
 * view instead of dropping the user at a generic dashboard list.
 */
export interface FocusOrderTarget {
  orderRef: string | null;
  orderId: string | null;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Scrolls (and briefly highlights) the order row matching the deep-link target.
 * `enabled` lets a view wait until its order list has actually rendered.
 */
export function useFocusOrderScroll(
  target: FocusOrderTarget | null | undefined,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !target) return;
    if (!target.orderRef && !target.orderId) return;

    const orderRef = target.orderRef;
    const orderId = target.orderId;

    const timer = window.setTimeout(() => {
      const selector = orderRef
        ? `[data-order-ref="${escapeAttributeValue(orderRef)}"]`
        : `[data-order-id="${escapeAttributeValue(orderId ?? '')}"]`;
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('ring-2', 'ring-emerald-500');
      window.setTimeout(() => {
        element.classList.remove('ring-2', 'ring-emerald-500');
      }, 2500);
    }, 400);

    return () => window.clearTimeout(timer);
  }, [enabled, target]);
}
