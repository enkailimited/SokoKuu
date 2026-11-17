import { Request } from 'express';
import { Role } from './roles.enum';

export type MerchantTier = 'WHOLESALE_HUB' | 'RETAIL_DUKA' | 'HYBRID_STORE';

export interface AuthenticatedUser {
  sub: string;
  role: Role;
  businessId?: string | null;
  merchantId?: string | null;
  tier?: MerchantTier | null;
  phoneE164?: string;
}

export interface TenantContext {
  businessId: string | null;
  merchantId: string | null;
  tier: MerchantTier | null;
  isPlatformManaged: boolean;
  geospatialMapEnabled: boolean;
  isSuperAdmin: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  tenantContext?: TenantContext;
}
