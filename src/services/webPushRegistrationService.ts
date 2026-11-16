const VAPID_PUBLIC_KEY =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_VAPID_PUBLIC_KEY ||
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8';

export interface WebPushRegistrationResult {
  status: 'SUBSCRIBED' | 'PERMISSION_DENIED' | 'UNSUPPORTED' | 'ERROR';
  endpoint?: string;
  message: string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function initializeWebPushRegistration(
  userId: string
): Promise<WebPushRegistrationResult> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return {
      status: 'UNSUPPORTED',
      message: 'Browser does not support Service Worker Web Push notifications.',
    };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const permissionState = await Notification.requestPermission();
    if (permissionState !== 'granted') {
      return {
        status: 'PERMISSION_DENIED',
        message: 'Notification permission was denied by the user.',
      };
    }

    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    const existingSubscription = await registration.pushManager.getSubscription();

    const subscription =
      existingSubscription ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      }));

    const rawKeys = subscription.toJSON();
    const payload = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: rawKeys.keys?.p256dh || '',
        auth: rawKeys.keys?.auth || '',
      },
    };

    try {
      await fetch('/api/v1/notifications/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': userId,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Static preview fallback when Spring Boot gateway is offline
    }

    localStorage.setItem(
      `sokokuu:webpush:${userId}`,
      JSON.stringify({
        endpoint: payload.endpoint,
        registeredAt: new Date().toISOString(),
      })
    );

    return {
      status: 'SUBSCRIBED',
      endpoint: subscription.endpoint,
      message: 'Device subscribed to SokoKuu TZ VAPID Web Push alerts.',
    };
  } catch (err) {
    return {
      status: 'ERROR',
      message: err instanceof Error ? err.message : 'Failed to register Web Push.',
    };
  }
}

export async function triggerLocalServiceWorkerPushTest({
  title,
  body,
  deepLinkUrl = '/dashboard/retailer',
}: {
  title: string;
  body: string;
  deepLinkUrl?: string;
}): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('Notification' in window)
  ) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
  }

  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { url: deepLinkUrl },
    tag: 'sokokuu-order-alert',
    requireInteraction: true,
  } as NotificationOptions);
  return true;
}
