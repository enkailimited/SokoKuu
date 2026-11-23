import { TRANSLATIONS, type Locale } from './data/i18n';

export { TRANSLATIONS, type Locale };

export const SOKO_DICT = {
  sw: {
    splash: {
      tagline: 'Nunua • Uza • Jisajili',
      loading: 'Inaandaa mazingira yako ya biashara...',
      continueBtn: 'Endelea',
    },
    nav: {
      dashboard: 'Dashibodi',
      pos: 'POS',
      settings: 'Mipangilio',
      sokoni: 'Sokoni',
      orders: 'Oda',
      inventory: 'Hifadhi',
      warehouse: 'Ghala',
      reports: 'Ripoti',
      profile: 'Wasifu',
      logout: 'Ondoka',
      menu: 'Menyu',
    },
    dashboard: {
      overview: 'Muhtasari',
      todaysOrders: 'Oda za Leo',
      todaysSales: 'Mauzo ya Leo (TZS)',
      storeStats: 'Takwimu za Stock & Faida',
      activeSkus: 'Bidhaa Hai',
      totalStockUnits: 'Hifadhi Iliyopo',
      lowStock: 'Tahadhari ya Stock',
      inventoryValue: 'Thamani ya Hifadhi',
      quickActions: 'Hatua za Haraka',
      recentOrders: 'Oda za Hivi Karibuni',
      viewAll: 'Zote',
      noOrdersTitle: 'Hakuna oda za hivi karibuni bado',
      noOrdersDesc: 'Oda zitakazoagizwa au kupokelewa kutoka Sokoni zitaonekana hapa.',
      goToSokoni: 'Nenda Sokoni',
      openPos: 'Fungua POS',
      scheduledFor: 'Imepangwa:',
      instantOrder: 'Papo Hapo',
      pendingCountSuffix: 'zinasubiri',
    },
    status: {
      PLACED: 'Inasubiri',
      DISPATCHED: 'Njiani',
      DELIVERED: 'Imekamilika',
      CANCELLED: 'Imesitishwa',
      DISPUTED: 'Mgogoro',
    },
    sokoni: {
      buyMode: 'Nunua Sokoni',
      sellMode: 'Uza Sokoni',
      myOrders: 'Oda Zangu & PIN',
      selectCategory: 'Chagua Kategoria',
      allCategories: 'Zote',
      searchPlaceholder: 'Tafuta bidhaa kwenye orodha kuu...',
      proceedToOrder: 'Endelea Kuagiza',
      clearSelection: 'Futa Chaguo',
      unitsShort: 'Vipimo',
      noCatalogTitle: 'Hakuna bidhaa zilizopatikana',
      noCatalogDesc: 'Badili kategoria au neno la utafutaji kuona bidhaa nyingine.',
      freeDeliveryTitle: 'Usafiri wa Bure (Free Delivery)',
      freeDeliveryDesc: 'Washa ili wanunuzi waone huduma ya usafiri bure kwenye duka lako.',
      publishStockTitle: 'Chapisha Stock Sokoni',
      publishBtn: 'Chapisha Sokoni',
    },
    discovery: {
      searchingTitle: 'Inatafuta Wauzaji Waliothibitishwa...',
      searchingSubtitle: 'Tunalinganisha bidhaa zako na hifadhi hai na ukaribu wa PostGIS.',
      merchantsFound: 'Wauzaji Waliopatikana',
      backToSokoni: 'Rudi Sokoni',
      orderSingle: 'Agiza',
      scheduledOrder: 'Panga Tarehe',
      instantOrder: 'Agiza Sasa',
      freeDelivery: 'Usafiri Bure',
      deliveryFee: 'Usafiri',
      missingLabel: 'Hazipo hapa:',
      subtotalLabel: 'Jumla Ndogo',
      noMerchantsTitle: 'Hakuna muuzaji aliyepatikana kwa sasa',
      noMerchantsDesc:
        'Hakuna mfanyabiashara aliye na stock hai ya bidhaa ulizochagua karibu nawe. Jaribu kurekebisha idadi au chagua bidhaa nyingine.',
      scheduleModalTitle: 'Panga Tarehe ya Uwasilishaji',
      scheduleDateLabel: 'Chagua Tarehe (YYYY-MM-DD)',
      confirmSchedule: 'Thibitisha Oda Iliyopangwa',
      cancel: 'Ghairi',
      submitting: 'Inatuma Oda...',
      receiptTitle: 'Oda Zimewasilishwa Kikamilifu!',
      receiptSubtitle: 'Namba zako za uthibitisho zimehifadhiwa kwenye mfumo.',
      viewOrdersBtn: 'Angalia Oda & PIN',
      backDashboardBtn: 'Rudi Dashibodi',
    },
  },
  en: {
    splash: {
      tagline: 'Nunua • Uza • Jisajili',
      loading: 'Preparing your marketplace workspace...',
      continueBtn: 'Continue',
    },
    nav: {
      dashboard: 'Dashboard',
      pos: 'POS',
      settings: 'Settings',
      sokoni: 'Sokoni',
      orders: 'Orders',
      inventory: 'Inventory',
      warehouse: 'Warehouse',
      reports: 'Reports',
      profile: 'Profile',
      logout: 'Logout',
      menu: 'Menu',
    },
    dashboard: {
      overview: 'Overview',
      todaysOrders: "Today's Orders",
      todaysSales: "Today's Sales (TZS)",
      storeStats: 'Store Statistics',
      activeSkus: 'Active SKUs',
      totalStockUnits: 'Stock On Hand',
      lowStock: 'Low Stock Alerts',
      inventoryValue: 'Inventory Value',
      quickActions: 'Quick Actions',
      recentOrders: 'Recently Orders',
      viewAll: 'View all',
      noOrdersTitle: 'No recent orders yet',
      noOrdersDesc: 'Incoming and Sokoni marketplace orders will appear here in real time.',
      goToSokoni: 'Open Sokoni',
      openPos: 'Open POS',
      scheduledFor: 'Scheduled:',
      instantOrder: 'Instant',
      pendingCountSuffix: 'pending',
    },
    status: {
      PLACED: 'Pending',
      DISPATCHED: 'In Transit',
      DELIVERED: 'Completed',
      CANCELLED: 'Cancelled',
      DISPUTED: 'Disputed',
    },
    sokoni: {
      buyMode: 'Nunua Sokoni',
      sellMode: 'Uza Sokoni',
      myOrders: 'My Orders & PIN',
      selectCategory: 'Select Category',
      allCategories: 'All',
      searchPlaceholder: 'Search standard catalog products...',
      proceedToOrder: 'Proceed to Order',
      clearSelection: 'Clear',
      unitsShort: 'Units',
      noCatalogTitle: 'No standard products found',
      noCatalogDesc: 'Adjust your selected categories or search query.',
      freeDeliveryTitle: 'Free Delivery',
      freeDeliveryDesc: 'Enable so buyers see Free Delivery across Sokoni discovery.',
      publishStockTitle: 'Publish Live Stock to Market',
      publishBtn: 'Publish to Market',
    },
    discovery: {
      searchingTitle: 'Searching Verified Merchants...',
      searchingSubtitle: 'Matching your basket against live stock and PostGIS proximity.',
      merchantsFound: 'Merchant Found',
      backToSokoni: 'Back to Sokoni',
      orderSingle: 'Order',
      scheduledOrder: 'Scheduled Order',
      instantOrder: 'Instant Order',
      freeDelivery: 'Free Delivery',
      deliveryFee: 'Delivery',
      missingLabel: 'Unavailable here:',
      subtotalLabel: 'Subtotal',
      noMerchantsTitle: 'No matching Merchants found',
      noMerchantsDesc:
        'No active verified Merchant currently has live stock for your selected items. Try adjusting quantities or selecting additional products.',
      scheduleModalTitle: 'Schedule Delivery Date',
      scheduleDateLabel: 'Delivery Date (YYYY-MM-DD)',
      confirmSchedule: 'Confirm Scheduled Order',
      cancel: 'Cancel',
      submitting: 'Submitting Orders...',
      receiptTitle: 'Orders Submitted Successfully!',
      receiptSubtitle: 'Your PostgreSQL order references are ready.',
      viewOrdersBtn: 'View Orders & PIN',
      backDashboardBtn: 'Back to Dashboard',
    },
  },
} as const;

type Dictionary = typeof SOKO_DICT.sw;
type DictPath<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : DictPath<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type I18nKey = DictPath<Dictionary>;

export function t(locale: Locale, key: I18nKey): string {
  const parts = key.split('.');
  let current: unknown = SOKO_DICT[locale] ?? SOKO_DICT.sw;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof current === 'string' ? current : key;
}
