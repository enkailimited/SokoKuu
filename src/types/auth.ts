export type PlatformRole = 'CONSUMER' | 'RETAILER' | 'WHOLESALER' | 'DRIVER' | 'SUPER_ADMIN';

export type AccountMode =
  | 'END_CONSUMER'
  | 'RETAIL_DUKA'
  | 'WHOLESALE_HUB'
  | 'HYBRID_STORE'
  | 'FLEET_RIDER'
  | 'PLATFORM_ADMIN';

export interface UserProfile {
  userId: string;
  fullName: string;
  phone: string;
  email: string;
  businessLabel: string;
  ward: string;
  streetAddress: string;
  role: PlatformRole;
  mode: AccountMode;
  smsAlertsEnabled: boolean;
  offlineSmsFallbackEnabled: boolean;
  pinCode: string;
}

export const ROLE_LABELS: Record<PlatformRole, { en: string; sw: string }> = {
  CONSUMER: { en: 'End Consumer', sw: 'Mlaji wa Mwisho' },
  RETAILER: { en: 'Retail Duka', sw: 'Muuzaji wa Rejareja' },
  WHOLESALER: { en: 'Wholesaler Hub', sw: 'Muuzaji wa Jumla' },
  DRIVER: { en: 'Delivery Driver', sw: 'Dereva Msafirishaji' },
  SUPER_ADMIN: { en: 'System Admin', sw: 'Msimamizi Mkuu' },
};

export const MODE_LABELS: Record<AccountMode, { en: string; sw: string }> = {
  END_CONSUMER: { en: 'Consumer Mode (B2C Fractions)', sw: 'Hali ya Mlaji (Vipimo vya Robo/Nusu)' },
  RETAIL_DUKA: { en: 'Retail Duka Mode', sw: 'Hali ya Duka la Rejareja' },
  WHOLESALE_HUB: { en: 'Pure Wholesale Mode (B2B)', sw: 'Hali ya Jumla Pekee (B2B)' },
  HYBRID_STORE: { en: 'Hybrid Store Mode (Jumla + Rejareja)', sw: 'Hali ya Duka Mseto (Jumla + Rejareja)' },
  FLEET_RIDER: { en: 'Fleet Rider Mode (Dual-PIN)', sw: 'Hali ya Dereva (Dual-PIN CoD)' },
  PLATFORM_ADMIN: { en: 'Platform Governance Mode', sw: 'Hali ya Usimamizi Mkuu' },
};

export const SEED_PLATFORM_ACCOUNTS: Record<PlatformRole, UserProfile> = {
  CONSUMER: {
    userId: 'usr-con-kinondoni-07',
    fullName: 'Neema John',
    phone: '+255 713 440 812',
    email: 'neema.john@sokokuu.tz',
    businessLabel: 'Household Buyer · Kinondoni',
    ward: 'Kinondoni Studio',
    streetAddress: 'Mtaa wa Vijana, Nyumba Na. 18',
    role: 'CONSUMER',
    mode: 'END_CONSUMER',
    smsAlertsEnabled: true,
    offlineSmsFallbackEnabled: true,
    pinCode: '1234',
  },
  RETAILER: {
    userId: 'usr-rt-sinza-04',
    fullName: 'Amina Hassan',
    phone: '+255 754 210 904',
    email: 'amina.duka@sokokuu.tz',
    businessLabel: 'Sinza Corner Duka',
    ward: 'Sinza Mori',
    streetAddress: 'Barabara ya Shekilango, Kiwanja 42',
    role: 'RETAILER',
    mode: 'RETAIL_DUKA',
    smsAlertsEnabled: true,
    offlineSmsFallbackEnabled: true,
    pinCode: '1234',
  },
  WHOLESALER: {
    userId: 'usr-ws-kariakoo-01',
    fullName: 'Amani Mwinyi',
    phone: '+255 784 900 112',
    email: 'amani.bulk@sokokuu.tz',
    businessLabel: 'Kariakoo Bulk Foods Hub',
    ward: 'Kariakoo',
    streetAddress: 'Mtaa wa Congo & Aggrey, Ghala 09',
    role: 'WHOLESALER',
    mode: 'HYBRID_STORE',
    smsAlertsEnabled: true,
    offlineSmsFallbackEnabled: true,
    pinCode: '1234',
  },
  DRIVER: {
    userId: 'usr-drv-bodaboda-09',
    fullName: 'Juma Bakari',
    phone: '+255 655 318 409',
    email: 'juma.rider@sokokuu.tz',
    businessLabel: 'Rider · MC 418 DKP',
    ward: 'Ilala / Kariakoo',
    streetAddress: 'Kituo cha Bodaboda Msimbazi',
    role: 'DRIVER',
    mode: 'FLEET_RIDER',
    smsAlertsEnabled: true,
    offlineSmsFallbackEnabled: true,
    pinCode: '1234',
  },
  SUPER_ADMIN: {
    userId: 'usr-adm-root-00',
    fullName: 'Baraka Masanja',
    phone: '+255 712 000 001',
    email: 'admin@sokokuu.tz',
    businessLabel: 'SokoKuu Platform Admin',
    ward: 'Posta / CBD',
    streetAddress: 'Samora Avenue, Dar es Salaam',
    role: 'SUPER_ADMIN',
    mode: 'PLATFORM_ADMIN',
    smsAlertsEnabled: true,
    offlineSmsFallbackEnabled: false,
    pinCode: '1234',
  },
};
