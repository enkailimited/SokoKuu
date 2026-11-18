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
  businessId?: string | null;
  smsShortCode?: string | null;
  tier?: string | null;
  geospatialMapEnabled?: boolean;
  isPlatformManaged?: boolean;
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
}

export function normalizeTzPhoneE164(raw: string): string {
  const compact = raw.replace(/[\s\-()]/g, '').trim();
  if (/^0[67][0-9]{8}$/.test(compact)) {
    return `+255${compact.slice(1)}`;
  }
  if (/^255[67][0-9]{8}$/.test(compact)) {
    return `+${compact}`;
  }
  return compact;
}

export function mapTierToAccountMode(
  role: PlatformRole,
  tier?: string | null
): AccountMode {
  if (role === 'SUPER_ADMIN') return 'PLATFORM_ADMIN';
  if (role === 'DRIVER') return 'FLEET_RIDER';
  if (role === 'CONSUMER') return 'END_CONSUMER';
  if (tier === 'HYBRID_STORE') return 'HYBRID_STORE';
  if (tier === 'WHOLESALE_HUB') return 'WHOLESALE_HUB';
  return role === 'WHOLESALER' ? 'WHOLESALE_HUB' : 'RETAIL_DUKA';
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
