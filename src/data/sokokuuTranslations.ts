export type SokoKuuLocale = 'sw' | 'en';

export interface SokoKuuPhraseDictionary {
  dispatchDropOff: string;
  orderConfirmed: string;
  enterSellerPin: string;
  enterBuyerPin: string;
  deliveryFee: string;
  cashOnDelivery: string;
  sentViaSms: string;
  confirmRecipient: string;
  networkOfflineBanner: string;
  reconcileEveningCash: string;
}

export const SOKOKUU_TRANSLATIONS: Record<SokoKuuLocale, SokoKuuPhraseDictionary> = {
  sw: {
    dispatchDropOff: 'Shusha mzigo mtaani',
    orderConfirmed: 'Oda imethibitishwa',
    enterSellerPin: 'Ingiza PIN ya muuzaji',
    enterBuyerPin: 'Ingiza PIN ya mnunuzi',
    deliveryFee: 'Gharama ya Usafiri',
    cashOnDelivery: 'Fedha Taslimu Mkononi (CoD)',
    sentViaSms: 'Oda imetumwa kwa SMS (NextSMS)',
    confirmRecipient: 'Thibitisha mpokeaji wa mzigo',
    networkOfflineBanner: 'Mtandao umekatika — unatumia hifadhi ya ndani',
    reconcileEveningCash: 'Funga hesabu za taslimu za jioni',
  },
  en: {
    dispatchDropOff: 'Drop shipment in the neighborhood',
    orderConfirmed: 'Order has been confirmed',
    enterSellerPin: 'Enter seller/driver PIN',
    enterBuyerPin: 'Enter buyer confirmation PIN',
    deliveryFee: 'Delivery Fee',
    cashOnDelivery: 'Cash on Delivery (CoD)',
    sentViaSms: 'Order dispatched via SMS (NextSMS)',
    confirmRecipient: 'Confirm shipment recipient',
    networkOfflineBanner: 'Offline mode — operating from local cache',
    reconcileEveningCash: 'Reconcile evening cash settlement',
  },
};

export function formatTzsAmount(amount: number, locale: SokoKuuLocale): string {
  const formatted = Math.round(amount).toLocaleString(locale === 'sw' ? 'sw-TZ' : 'en-TZ');
  return locale === 'sw' ? `TZS ${formatted}/=` : `TZS ${formatted}`;
}
