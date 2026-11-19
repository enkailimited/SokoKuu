import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Navigation,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Store,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  TANZANIA_REGIONS,
  extractRegionFromWard,
  type ManagedWholesaleProfile,
  type TanzaniaRegion,
} from '../lib/sokoManagedState';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

interface BackendMerchantDirectoryRecord {
  merchantId: string;
  smsShortCode: string;
  merchantName: string;
  tier: string;
  ward: string;
  district: string;
  streetAddress: string;
  latitude: number;
  longitude: number;
  isOpen: boolean;
  isPlatformManaged: boolean;
  geospatialMapEnabled: boolean;
  logoCdnUrl?: string | null;
  owner?: {
    userId: string;
    fullName: string;
    phoneE164: string;
  };
  createdAt: string;
}

interface DirectoryMerchantItem extends ManagedWholesaleProfile {
  geospatialMapEnabled?: boolean;
  isOpen?: boolean;
  logoCdnUrl?: string | null;
  smsShortCode?: string;
  tierCode?: string;
}

// ============================================================================
// AdminMerchantsDirectoryPanel.tsx
// Orodha ya Wafanyabiashara Waliothibitishwa + Mipangilio ya Kila Mfanyabiashara
// ============================================================================
export function AdminMerchantsDirectoryPanel({ locale = 'sw' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [merchants, setMerchants] = useState<DirectoryMerchantItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<'ALL' | 'Wholesaler' | 'Retailer'>('ALL');
  const [regionFilter, setRegionFilter] = useState<'ALL' | TanzaniaRegion>('ALL');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const loadDirectoryFromApi = useCallback(async () => {
    setIsLoading(true);
    setErrorBanner(null);
    try {
      const res = await SokoApiClient.get<{
        count: number;
        merchants: BackendMerchantDirectoryRecord[];
      }>('/admin/merchants');

      const mapped: DirectoryMerchantItem[] = (res.merchants || []).map((m) => {
        const wardJoined = m.district && !m.ward.toLowerCase().includes(m.district.toLowerCase())
          ? `${m.ward}, ${m.district}`
          : m.ward;
        return {
          businessId: m.merchantId,
          businessName: m.merchantName,
          smsShortCode: m.smsShortCode,
          tierCode: m.tier,
          roleTier: m.tier === 'WHOLESALE' ? 'Wholesaler' : 'Retailer',
          region: extractRegionFromWard(`${m.ward} ${m.district}`),
          ward: wardJoined,
          latitude: m.latitude,
          longitude: m.longitude,
          isPlatformManaged: m.isPlatformManaged,
          geospatialMapEnabled: m.geospatialMapEnabled,
          isOpen: m.isOpen,
          logoCdnUrl: m.logoCdnUrl ?? null,
          isConverted: true,
          isVerified: true,
          ownerName: m.owner?.fullName,
          ownerPhoneE164: m.owner?.phoneE164,
          geoTenantId: m.merchantId,
          updatedAtEat: new Date(m.createdAt).toLocaleDateString(),
        };
      });

      setMerchants(mapped);
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setMerchants([]);
      } else {
        setErrorBanner(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Failed to load verified merchants directory.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDirectoryFromApi();

    const handleRefreshEvent = () => {
      void loadDirectoryFromApi();
    };
    window.addEventListener('sokokuu:merchants-updated', handleRefreshEvent);
    window.addEventListener('sokokuu:geospatial-toggle-updated', handleRefreshEvent);
    return () => {
      window.removeEventListener('sokokuu:merchants-updated', handleRefreshEvent);
      window.removeEventListener('sokokuu:geospatial-toggle-updated', handleRefreshEvent);
    };
  }, [loadDirectoryFromApi]);

  const convertedVerifiedMerchants = merchants.filter(
    (s) => (s.isConverted ?? true) && (s.isVerified ?? true)
  );

  const handleToggleOrderRouting = async (merchant: DirectoryMerchantItem) => {
    setErrorBanner(null);
    const nextManaged = !merchant.isPlatformManaged;
    setBusyId(merchant.businessId);

    try {
      const res = await SokoApiClient.patch<{
        merchantId: string;
        merchantName: string;
        isPlatformManaged: boolean;
      }>(`/admin/merchants/${merchant.businessId}/platform-managed`, {
        isPlatformManaged: nextManaged,
      });

      setMerchants((prev) =>
        prev.map((m) =>
          m.businessId === merchant.businessId
            ? { ...m, isPlatformManaged: res.isPlatformManaged }
            : m
        )
      );
      setBackendOffline(false);

      setStatusNotice(
        isSw
          ? `${merchant.businessName}: Mipangilio ya Oda sasa ni ${
              res.isPlatformManaged
                ? 'Kupokelewa na Admin (Helpdesk)'
                : 'Moja kwa Moja kwa Mfanyabiashara'
            }.`
          : `${merchant.businessName}: Order routing updated to ${
              res.isPlatformManaged ? 'Admin Helpdesk Queue' : 'Direct Merchant Terminal'
            }.`
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorBanner(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to update order routing.'
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleVerification = async (merchant: DirectoryMerchantItem) => {
    setErrorBanner(null);
    const nextOpen = !merchant.isOpen;
    setBusyId(merchant.businessId);

    try {
      const res = await SokoApiClient.patch<{
        merchantId: string;
        merchantName: string;
        isOpen: boolean;
      }>(`/admin/merchants/${merchant.businessId}/verification`, {
        isOpen: nextOpen,
      });

      setMerchants((prev) =>
        prev.map((m) =>
          m.businessId === merchant.businessId
            ? { ...m, isOpen: res.isOpen }
            : m
        )
      );
      setBackendOffline(false);
      window.dispatchEvent(new CustomEvent('sokokuu:merchants-updated'));

      setStatusNotice(
        isSw
          ? `${merchant.businessName}: Uthibitisho sasa ni ${
              res.isOpen ? 'UMETHIBITISHWA (uneonekana sokoni)' : 'UMESITISHWA'
            }.`
          : `${merchant.businessName}: Verification is now ${
              res.isOpen ? 'VERIFIED (visible in marketplace)' : 'SUSPENDED'
            }.`
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorBanner(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to update merchant verification.'
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleMapAccess = async (merchant: DirectoryMerchantItem) => {
    setErrorBanner(null);
    const nextEnabled = !merchant.geospatialMapEnabled;
    setBusyId(merchant.businessId);

    try {
      const res = await SokoApiClient.post<{
        merchantId: string;
        geospatialMapEnabled: boolean;
      }>(`/admin/merchants/${merchant.businessId}/toggle-map`, {
        enabled: nextEnabled,
      });

      setMerchants((prev) =>
        prev.map((m) =>
          m.businessId === merchant.businessId
            ? { ...m, geospatialMapEnabled: res.geospatialMapEnabled }
            : m
        )
      );
      setBackendOffline(false);
      window.dispatchEvent(new CustomEvent('sokokuu:geospatial-toggle-updated'));

      setStatusNotice(
        isSw
          ? `${merchant.businessName}: Ruhusa ya Ramani ya Ukaribu ${
              res.geospatialMapEnabled ? 'IMEWASHWA' : 'IMEFUNGWA'
            }.`
          : `${merchant.businessName}: Proximity Map access ${
              res.geospatialMapEnabled ? 'ENABLED' : 'LOCKED'
            }.`
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorBanner(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to update geospatial map permission.'
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const filteredMerchants = convertedVerifiedMerchants.filter((merchant) => {
    const tier = merchant.roleTier ?? 'Wholesaler';
    const merchantRegion = merchant.region ?? extractRegionFromWard(merchant.ward);
    const matchesTier = tierFilter === 'ALL' || tier === tierFilter;
    const matchesRegion = regionFilter === 'ALL' || merchantRegion === regionFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      q.length === 0 ||
      merchant.businessName.toLowerCase().includes(q) ||
      merchant.ward.toLowerCase().includes(q) ||
      merchantRegion.toLowerCase().includes(q) ||
      (merchant.smsShortCode?.toLowerCase().includes(q) ?? false);
    return matchesTier && matchesRegion && matchesSearch;
  });

  const adminManagedCount = convertedVerifiedMerchants.filter((s) => s.isPlatformManaged).length;

  return (
    <div className="space-y-4">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void loadDirectoryFromApi()}
          retrying={isLoading}
        />
      )}
      {errorBanner && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-semibold text-red-900"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-red-800 hover:text-red-950 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {statusNotice && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-semibold text-emerald-950"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{statusNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-emerald-800 hover:text-emerald-950 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <Store className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {isSw
                  ? 'Wafanyabiashara & Mipangilio (Converted & Verified Merchants)'
                  : 'Converted & Verified Merchants Directory'}
              </h2>
              <p className="text-xs text-slate-500">
                {isSw
                  ? `Wafanyabiashara ${convertedVerifiedMerchants.length} waliothibitishwa · ${adminManagedCount} wanaelekeza oda kwa Admins`
                  : `${convertedVerifiedMerchants.length} verified merchants · ${adminManagedCount} routed to Admin Live Queue`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadDirectoryFromApi()}
              disabled={isLoading}
              className="px-2.5 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
            </button>

            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isSw ? 'Tafuta mfanyabiashara, kata, mkoa...' : 'Search merchant, ward, region...'}
                className="pl-8 pr-3 py-1.5 min-h-[36px] text-xs rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value as 'ALL' | TanzaniaRegion)}
              aria-label={isSw ? 'Chagua Mkoa' : 'Select Region'}
              className="px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 cursor-pointer"
            >
              {TANZANIA_REGIONS.map((reg) => (
                <option key={reg.key} value={reg.key}>
                  {isSw ? reg.labelSw : reg.labelEn}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              {(
                [
                  { key: 'ALL', sw: 'Yote', en: 'All' },
                  { key: 'Wholesaler', sw: 'Jumla', en: 'Wholesalers' },
                  { key: 'Retailer', sw: 'Rejareja', en: 'Retailers' },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTierFilter(t.key)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    tierFilter === t.key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {isSw ? t.sw : t.en}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading && merchants.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            {isSw ? 'Inapakia orodha ya wafanyabiashara...' : 'Loading verified merchants from database...'}
          </div>
        ) : filteredMerchants.length === 0 ? (
          <EmptyStateCard
            locale={locale}
            titleSw="Hakuna wafanyabiashara waliothibitishwa"
            titleEn="No verified merchants found"
            descriptionSw="Hakuna rekodi za wafanyabiashara zinazolingana kwenye PostgreSQL."
            descriptionEn="No converted & verified merchants match the active filter in PostgreSQL."
          />
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {filteredMerchants.map((merchant) => {
              const mapEnabled = Boolean(merchant.geospatialMapEnabled);
              const merchantRegion = merchant.region ?? extractRegionFromWard(merchant.ward);
              const tierLabel =
                merchant.tierCode === 'HYBRID_STORE'
                  ? isSw
                    ? 'Mfanyabiashara Mseto (Hybrid)'
                    : 'Hybrid Merchant'
                  : (merchant.roleTier ?? 'Wholesaler') === 'Wholesaler'
                    ? isSw
                      ? 'Mfanyabiashara wa Jumla'
                      : 'Wholesale Merchant'
                    : isSw
                      ? 'Mfanyabiashara wa Rejareja'
                      : 'Retail Merchant';

              return (
                <div
                  key={merchant.businessId}
                  className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white hover:bg-slate-50/50"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {merchant.logoCdnUrl && (
                        <img
                          src={merchant.logoCdnUrl}
                          alt={merchant.businessName}
                          className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0"
                        />
                      )}
                      <span className="text-xs sm:text-sm font-bold text-slate-900">
                        {merchant.businessName}
                      </span>
                      {merchant.smsShortCode && (
                        <span className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                          {merchant.smsShortCode}
                        </span>
                      )}
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {tierLabel}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800">
                        <ShieldCheck className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                        <span>
                          {merchant.isOpen
                            ? isSw
                              ? 'Imethibitishwa'
                              : 'Verified'
                            : isSw
                              ? 'Inasubiri Uthibitisho'
                              : 'Pending Verification'}
                        </span>
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                        <MapPin className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                        {merchant.ward}
                      </span>
                      <span>·</span>
                      <span className="text-emerald-700 font-semibold">{merchantRegion}</span>
                      {merchant.latitude != null && merchant.longitude != null && (
                        <>
                          <span>·</span>
                          <span className="font-mono text-slate-500">
                            {merchant.latitude.toFixed(4)}, {merchant.longitude.toFixed(4)}
                          </span>
                        </>
                      )}
                      {merchant.ownerPhoneE164 && (
                        <>
                          <span>·</span>
                          <span className="font-mono text-slate-600">{merchant.ownerPhoneE164}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>
                        {isSw ? 'Ilisasishwa:' : 'Updated:'} {merchant.updatedAtEat}
                      </span>
                    </div>
                  </div>

                  {/* Per-Merchant Settings Controls */}
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      disabled={busyId === merchant.businessId}
                      onClick={() => void handleToggleVerification(merchant)}
                      className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50 ${
                        merchant.isOpen
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                          : 'border-amber-500 bg-amber-50 text-amber-900 hover:bg-amber-100'
                      }`}
                    >
                      {merchant.isOpen ? (
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <ShieldOff className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                      )}
                      <span>
                        {isSw ? 'Uthibitisho:' : 'Verify:'}{' '}
                        {merchant.isOpen
                          ? isSw
                            ? 'Imethibitishwa'
                            : 'Verified'
                          : isSw
                            ? 'Thibitisha'
                            : 'Verify'}
                      </span>
                      {merchant.isOpen ? (
                        <ToggleRight className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <ToggleLeft className="w-4 h-4 text-amber-600" aria-hidden="true" />
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={busyId === merchant.businessId}
                      onClick={() => void handleToggleOrderRouting(merchant)}
                      className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50 ${
                        merchant.isPlatformManaged
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <PhoneCall
                        className={`w-3.5 h-3.5 ${
                          merchant.isPlatformManaged ? 'text-emerald-600' : 'text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span>
                        {isSw ? 'Oda:' : 'Orders:'}{' '}
                        {merchant.isPlatformManaged
                          ? isSw
                            ? 'Admin Pekee'
                            : 'Admin Managed'
                          : isSw
                            ? 'Mfanyabiashara Mwenyewe'
                            : 'Direct Merchant'}
                      </span>
                      {merchant.isPlatformManaged ? (
                        <ToggleRight className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <ToggleLeft className="w-4 h-4 text-slate-400" aria-hidden="true" />
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={busyId === merchant.businessId}
                      onClick={() => void handleToggleMapAccess(merchant)}
                      className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50 ${
                        mapEnabled
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Navigation
                        className={`w-3.5 h-3.5 ${
                          mapEnabled ? 'text-emerald-600' : 'text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span>
                        {isSw ? 'Ramani:' : 'Map:'}{' '}
                        {mapEnabled
                          ? isSw
                            ? 'Imewashwa'
                            : 'Enabled'
                          : isSw
                            ? 'Imefungwa'
                            : 'Locked'}
                      </span>
                      {mapEnabled ? (
                        <ToggleRight className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <ToggleLeft className="w-4 h-4 text-slate-400" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
