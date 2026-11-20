import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  FileText,
  LoaderCircle,
  MapPin,
  Navigation,
  Package,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Store,
  ToggleLeft,
  ToggleRight,
  UserCheck,
  UserX,
  X,
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
import { ConfirmDestructiveDialog } from './ConfirmDestructiveDialog';

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
  accountStatus?: string;
  suspensionReason?: string | null;
  suspendedAt?: string | null;
  suspendedByAdminId?: string | null;
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
  isSuspended?: boolean;
  accountStatus?: string;
  suspensionReason?: string | null;
  logoCdnUrl?: string | null;
  smsShortCode?: string;
  tierCode?: string;
}

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
  const [suspendDialog, setSuspendDialog] = useState<{
    merchant: DirectoryMerchantItem;
    nextSuspended: boolean;
  } | null>(null);
  const [suspendReason, setSuspendReason] = useState<string>('');
  const [isSuspending, setIsSuspending] = useState<boolean>(false);

  const [dossierOpen, setDossierOpen] = useState(false);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState<string | null>(null);
  const [dossier, setDossier] = useState<any | null>(null);
  const [dossierSuspendReason, setDossierSuspendReason] = useState('');

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
        const suspended = (m.accountStatus || '').toUpperCase() === 'SUSPENDED' || m.isOpen === false;
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
          isSuspended: suspended,
          accountStatus: m.accountStatus ?? (suspended ? 'SUSPENDED' : 'ACTIVE'),
          suspensionReason: m.suspensionReason ?? null,
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

  const openMerchantDossier = async (businessId: string) => {
    setDossierOpen(true);
    setDossierLoading(true);
    setDossierError(null);
    setDossier(null);
    setDossierSuspendReason('');
    try {
      const res = await SokoApiClient.get<any>(`/admin/merchants/${businessId}/dossier`);
      setDossier(res);
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      setDossierError(
        err instanceof SokoHttpError ? `HTTP ${err.status}: ${err.message}` : err instanceof Error ? err.message : (isSw ? 'Imeshindikana kupakia taarifa za mfanyabiashara.' : 'Failed to load merchant dossier.'),
      );
    } finally {
      setDossierLoading(false);
    }
  };

  const updateMerchantStatus = async (businessId: string, nextSuspended: boolean, reason: string) => {
    const trimmed = reason.trim();
    if (nextSuspended && !trimmed) {
      throw new Error(isSw ? 'Sababu ya kusimamisha akaunti ni lazima.' : 'Suspension reason is required.');
    }
    if (nextSuspended) {
      const ok = window.confirm(isSw ? 'Una uhakika unataka kusimamisha akaunti ya mfanyabiashara huyu?' : 'Are you sure you want to suspend this merchant account?');
      if (!ok) return false;
    }
    await SokoApiClient.patch(`/admin/merchants/${businessId}/status`, {
      suspended: nextSuspended,
      ...(trimmed ? { reason: trimmed } : {}),
    });
    return true;
  };

  const handleSetMerchantStatusFromDossier = async (nextSuspended: boolean) => {
    if (!dossier?.merchant?.merchantId) return;
    setIsSuspending(true);
    setDossierError(null);
    try {
      const ok = await updateMerchantStatus(dossier.merchant.merchantId, nextSuspended, dossierSuspendReason);
      if (!ok) return;
      await openMerchantDossier(dossier.merchant.merchantId);
      await loadDirectoryFromApi();
      window.dispatchEvent(new CustomEvent('sokokuu:merchants-updated'));
      setStatusNotice(
        isSw
          ? nextSuspended ? 'Mfanyabiashara amesimamishwa.' : 'Mfanyabiashara amerudishwa (akaunti hai).'
          : nextSuspended ? 'Merchant suspended.' : 'Merchant reinstated.',
      );
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      setDossierError(
        err instanceof SokoHttpError ? `HTTP ${err.status}: ${err.message}` : err instanceof Error ? err.message : (isSw ? 'Imeshindikana kusasisha hali ya akaunti.' : 'Failed to update merchant status.'),
      );
    } finally {
      setIsSuspending(false);
    }
  };

  const convertedVerifiedMerchants = merchants.filter(
    (s) => (s.isConverted ?? true) && (s.isVerified ?? true)
  );

  const handleToggleOrderRouting = async (merchant: DirectoryMerchantItem) => {
    setErrorBanner(null);
    const nextManaged = !merchant.isPlatformManaged;
    setBusyId(merchant.businessId);
    try {
      const res = await SokoApiClient.patch<any>(`/admin/merchants/${merchant.businessId}/platform-managed`, {
        isPlatformManaged: nextManaged,
      });
      setMerchants((prev) => prev.map((m) => (m.businessId === merchant.businessId ? { ...m, isPlatformManaged: res.isPlatformManaged } : m)));
      setBackendOffline(false);
      setStatusNotice(
        isSw
          ? `${merchant.businessName}: Mipangilio ya Oda sasa ni ${res.isPlatformManaged ? 'Kupokelewa na Admin (Helpdesk)' : 'Moja kwa Moja kwa Mfanyabiashara'}.`
          : `${merchant.businessName}: Order routing updated to ${res.isPlatformManaged ? 'Admin Helpdesk Queue' : 'Direct Merchant Terminal'}.`,
      );
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      else setErrorBanner(err instanceof SokoHttpError ? `HTTP ${err.status}: ${err.message}` : 'Failed to update order routing.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleVerification = async (merchant: DirectoryMerchantItem) => {
    setErrorBanner(null);
    const nextOpen = !merchant.isOpen;
    setBusyId(merchant.businessId);
    try {
      const res = await SokoApiClient.patch<any>(`/admin/merchants/${merchant.businessId}/verification`, { isOpen: nextOpen });
      setMerchants((prev) => prev.map((m) => (m.businessId === merchant.businessId ? { ...m, isOpen: res.isOpen } : m)));
      setBackendOffline(false);
      window.dispatchEvent(new CustomEvent('sokokuu:merchants-updated'));
      setStatusNotice(
        isSw
          ? `${merchant.businessName}: Uthibitisho sasa ni ${res.isOpen ? 'UMETHIBITISHWA (uneonekana sokoni)' : 'UMESITISHWA'}.`
          : `${merchant.businessName}: Verification is now ${res.isOpen ? 'VERIFIED (visible in marketplace)' : 'SUSPENDED'}.`,
      );
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      else setErrorBanner(err instanceof SokoHttpError ? `HTTP ${err.status}: ${err.message}` : 'Failed to update merchant verification.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleMapAccess = async (merchant: DirectoryMerchantItem) => {
    setErrorBanner(null);
    const nextEnabled = !merchant.geospatialMapEnabled;
    setBusyId(merchant.businessId);
    try {
      const res = await SokoApiClient.post<any>(`/admin/merchants/${merchant.businessId}/toggle-map`, { enabled: nextEnabled });
      setMerchants((prev) => prev.map((m) => (m.businessId === merchant.businessId ? { ...m, geospatialMapEnabled: res.geospatialMapEnabled } : m)));
      setBackendOffline(false);
      window.dispatchEvent(new CustomEvent('sokokuu:geospatial-toggle-updated'));
      setStatusNotice(
        isSw
          ? `${merchant.businessName}: Ruhusa ya Ramani ya Ukaribu ${res.geospatialMapEnabled ? 'IMEWASHWA' : 'IMEFUNGWA'}.`
          : `${merchant.businessName}: Proximity Map access ${res.geospatialMapEnabled ? 'ENABLED' : 'LOCKED'}.`,
      );
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      else setErrorBanner(err instanceof SokoHttpError ? `HTTP ${err.status}: ${err.message}` : 'Failed to update geospatial map permission.');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmSuspension = async () => {
    if (!suspendDialog) return;
    const { merchant, nextSuspended } = suspendDialog;
    const reason = suspendReason.trim();
    if (nextSuspended && !reason) {
      setErrorBanner(isSw ? 'Sababu ya kusimamisha akaunti ni lazima.' : 'Suspension reason is required.');
      return;
    }
    setIsSuspending(true);
    setErrorBanner(null);
    try {
      const ok = await updateMerchantStatus(merchant.businessId, nextSuspended, reason);
      if (!ok) { setIsSuspending(false); return; }
      await loadDirectoryFromApi();
      setBackendOffline(false);
      window.dispatchEvent(new CustomEvent('sokokuu:merchants-updated'));
      setStatusNotice(
        isSw
          ? `${merchant.businessName}: ${nextSuspended ? 'Amesimamishwa' : 'Amerejeshwa'} kikamilifu.`
          : `${merchant.businessName}: ${nextSuspended ? 'Suspended' : 'Restored'} successfully.`,
      );
      setSuspendDialog(null);
      setSuspendReason('');
    } catch (err) {
      if (isSokoNetworkError(err)) setBackendOffline(true);
      else setErrorBanner(err instanceof SokoHttpError ? `HTTP ${err.status}: ${err.message}` : (isSw ? 'Imeshindikana kusasisha hali ya kusimamishwa kwa Mfanyabiashara.' : 'Failed to update merchant suspension status.'));
    } finally {
      setIsSuspending(false);
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
        <BackendOfflineBanner locale={locale} onRetry={() => void loadDirectoryFromApi()} retrying={isLoading} />
      )}
      {errorBanner && (
        <div role="alert" className="border border-red-200 bg-red-50 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-semibold text-red-900">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
            <span>{errorBanner}</span>
          </div>
          <button type="button" onClick={() => setErrorBanner(null)} className="text-red-800 hover:text-red-950 cursor-pointer">×</button>
        </div>
      )}
      {statusNotice && (
        <div role="status" className="border border-emerald-200 bg-emerald-50 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-semibold text-emerald-950">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{statusNotice}</span>
          </div>
          <button type="button" onClick={() => setStatusNotice(null)} className="text-emerald-800 hover:text-emerald-950 cursor-pointer">×</button>
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
                {isSw ? 'Wafanyabiashara & Mipangilio (Converted & Verified Merchants)' : 'Converted & Verified Merchants Directory'}
              </h2>
              <p className="text-xs text-slate-500">
                {isSw
                  ? `Wafanyabiashara ${convertedVerifiedMerchants.length} waliothibitishwa · ${adminManagedCount} wanaelekeza oda kwa Admins`
                  : `${convertedVerifiedMerchants.length} verified merchants · ${adminManagedCount} routed to Admin Live Queue`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void loadDirectoryFromApi()} disabled={isLoading} className="px-2.5 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
            </button>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={isSw ? 'Tafuta mfanyabiashara, kata, mkoa...' : 'Search merchant, ward, region...'} className="pl-8 pr-3 py-1.5 min-h-[36px] text-xs rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
            </div>
            <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value as 'ALL' | TanzaniaRegion)} aria-label={isSw ? 'Chagua Mkoa' : 'Select Region'} className="px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 cursor-pointer">
              {TANZANIA_REGIONS.map((reg) => (<option key={reg.key} value={reg.key}>{isSw ? reg.labelSw : reg.labelEn}</option>))}
            </select>
            <div className="flex items-center gap-1">
              {([
                { key: 'ALL', sw: 'Yote', en: 'All' },
                { key: 'Wholesaler', sw: 'Jumla', en: 'Wholesalers' },
                { key: 'Retailer', sw: 'Rejareja', en: 'Retailers' },
              ] as const).map((t) => (
                <button key={t.key} type="button" onClick={() => setTierFilter(t.key)} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${tierFilter === t.key ? 'bg-slate-900 text-white' : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
                  {isSw ? t.sw : t.en}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading && merchants.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">{isSw ? 'Inapakia orodha ya wafanyabiashara...' : 'Loading verified merchants from database...'}</div>
        ) : filteredMerchants.length === 0 ? (
          <EmptyStateCard locale={locale} titleSw="Hakuna wafanyabiashara waliothibitishwa" titleEn="No verified merchants found" descriptionSw="Hakuna rekodi za wafanyabiashara zinazolingana kwenye PostgreSQL." descriptionEn="No converted & verified merchants match the active filter in PostgreSQL." />
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {filteredMerchants.map((merchant) => {
              const mapEnabled = Boolean(merchant.geospatialMapEnabled);
              const merchantRegion = merchant.region ?? extractRegionFromWard(merchant.ward);
              const tierLabel = merchant.tierCode === 'HYBRID_STORE'
                ? (isSw ? 'Mfanyabiashara Mseto (Hybrid)' : 'Hybrid Merchant')
                : (merchant.roleTier ?? 'Wholesaler') === 'Wholesaler'
                  ? (isSw ? 'Mfanyabiashara wa Jumla' : 'Wholesale Merchant')
                  : (isSw ? 'Mfanyabiashara wa Rejareja' : 'Retail Merchant');
              const suspended = !!merchant.isSuspended || (merchant.accountStatus || '').toUpperCase() === 'SUSPENDED';
              return (
                <div key={merchant.businessId} className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white hover:bg-slate-50/50">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {merchant.logoCdnUrl && <img src={merchant.logoCdnUrl} alt={merchant.businessName} className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0" />}
                      <span className="text-xs sm:text-sm font-bold text-slate-900">{merchant.businessName}</span>
                      {merchant.smsShortCode && <span className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{merchant.smsShortCode}</span>}
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">{tierLabel}</span>
                      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border ${suspended ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                        {suspended ? <UserX className="w-3 h-3" aria-hidden="true" /> : <ShieldCheck className="w-3 h-3" aria-hidden="true" />}
                        <span>{suspended ? (isSw ? 'Amesimamishwa' : 'Suspended') : merchant.isOpen ? (isSw ? 'Imethibitishwa' : 'Verified') : (isSw ? 'Inasubiri Uthibitisho' : 'Pending Verification')}</span>
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-700"><MapPin className="w-3 h-3 text-emerald-600" aria-hidden="true" />{merchant.ward}</span>
                      <span>·</span><span className="text-emerald-700 font-semibold">{merchantRegion}</span>
                      {merchant.latitude != null && merchant.longitude != null && (<><span>·</span><span className="font-mono text-slate-500">{merchant.latitude.toFixed(4)}, {merchant.longitude.toFixed(4)}</span></>)}
                      {merchant.ownerPhoneE164 && (<><span>·</span><span className="font-mono text-slate-600">{merchant.ownerPhoneE164}</span></>)}
                      <span>·</span><span>{isSw ? 'Ilisasishwa:' : 'Updated:'} {merchant.updatedAtEat}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button type="button" onClick={() => void openMerchantDossier(merchant.businessId)} className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer">
                      <FileText className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                      <span>{isSw ? 'Fungua Mfanyabiashara' : 'Open Merchant'}</span>
                    </button>

                    <button type="button" disabled={busyId === merchant.businessId} onClick={() => void handleToggleVerification(merchant)} className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50 ${merchant.isOpen ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100' : 'border-amber-500 bg-amber-50 text-amber-900 hover:bg-amber-100'}`}>
                      {merchant.isOpen ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" /> : <ShieldOff className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />}
                      <span>{isSw ? 'Uthibitisho:' : 'Verify:'} {merchant.isOpen ? (isSw ? 'Imethibitishwa' : 'Verified') : (isSw ? 'Thibitisha' : 'Verify')}</span>
                      {merchant.isOpen ? <ToggleRight className="w-4 h-4 text-emerald-600" aria-hidden="true" /> : <ToggleLeft className="w-4 h-4 text-amber-600" aria-hidden="true" />}
                    </button>

                    <button type="button" disabled={busyId === merchant.businessId} onClick={() => void handleToggleOrderRouting(merchant)} className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50 ${merchant.isPlatformManaged ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>
                      <PhoneCall className={`w-3.5 h-3.5 ${merchant.isPlatformManaged ? 'text-emerald-600' : 'text-slate-400'}`} aria-hidden="true" />
                      <span>{isSw ? 'Oda:' : 'Orders:'} {merchant.isPlatformManaged ? (isSw ? 'Admin Pekee' : 'Admin Managed') : (isSw ? 'Mfanyabiashara Mwenyewe' : 'Direct Merchant')}</span>
                      {merchant.isPlatformManaged ? <ToggleRight className="w-4 h-4 text-emerald-600" aria-hidden="true" /> : <ToggleLeft className="w-4 h-4 text-slate-400" aria-hidden="true" />}
                    </button>

                    <button type="button" disabled={busyId === merchant.businessId} onClick={() => void handleToggleMapAccess(merchant)} className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50 ${mapEnabled ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>
                      <Navigation className={`w-3.5 h-3.5 ${mapEnabled ? 'text-emerald-600' : 'text-slate-400'}`} aria-hidden="true" />
                      <span>{isSw ? 'Ramani:' : 'Map:'} {mapEnabled ? (isSw ? 'Imewashwa' : 'Enabled') : (isSw ? 'Imefungwa' : 'Locked')}</span>
                      {mapEnabled ? <ToggleRight className="w-4 h-4 text-emerald-600" aria-hidden="true" /> : <ToggleLeft className="w-4 h-4 text-slate-400" aria-hidden="true" />}
                    </button>

                    <button type="button" disabled={busyId === merchant.businessId} onClick={() => { setSuspendReason(''); setSuspendDialog({ merchant, nextSuspended: !suspended }); }} className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50 ${suspended ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100' : 'border-red-200 bg-white text-red-800 hover:bg-red-50 hover:border-red-300'}`}>
                      {suspended ? <UserCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" /> : <UserX className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />}
                      <span>{suspended ? (isSw ? 'Rejesha' : 'Restore') : (isSw ? 'Simamisha' : 'Suspend')}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {suspendDialog && (
        <ConfirmDestructiveDialog
          locale={locale}
          titleSw={suspendDialog.nextSuspended ? 'Simamisha Mfanyabiashara' : 'Rejesha Mfanyabiashara'}
          titleEn={suspendDialog.nextSuspended ? 'Suspend Merchant' : 'Restore Merchant'}
          descriptionSw={suspendDialog.nextSuspended ? `Mfanyabiashara "${suspendDialog.merchant.businessName}" atasimamishwa. Sababu ni lazima.` : `Mfanyabiashara "${suspendDialog.merchant.businessName}" atarejeshwa kwenye mfumo.`}
          descriptionEn={suspendDialog.nextSuspended ? `Merchant "${suspendDialog.merchant.businessName}" will be suspended. Reason is required.` : `Merchant "${suspendDialog.merchant.businessName}" will be restored.`}
          confirmLabelSw={suspendDialog.nextSuspended ? 'Simamisha' : 'Rejesha'}
          confirmLabelEn={suspendDialog.nextSuspended ? 'Suspend' : 'Restore'}
          isBusy={isSuspending}
          onConfirm={() => void handleConfirmSuspension()}
          onCancel={() => { setSuspendDialog(null); setSuspendReason(''); }}
        >
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">{isSw ? `Sababu ${suspendDialog.nextSuspended ? '(lazima)' : '(hiari)'}` : `Reason ${suspendDialog.nextSuspended ? '(required)' : '(optional)'}`}</span>
            <textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} rows={3} className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900" placeholder={isSw ? 'Andika sababu ya sera...' : 'Enter policy reason...'} />
          </label>
        </ConfirmDestructiveDialog>
      )}

      {dossierOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-2xl">
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><FileText className="w-4 h-4 text-emerald-700" aria-hidden="true" /><span>{isSw ? 'Taarifa za Mfanyabiashara (Merchant Dossier)' : 'Merchant Dossier'}</span></h3>
                {dossier?.merchant?.merchantName && <p className="text-xs text-slate-600 mt-0.5">{dossier.merchant.merchantName} · <span className="font-mono">{dossier.merchant.smsShortCode}</span></p>}
              </div>
              <button type="button" onClick={() => setDossierOpen(false)} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer" aria-label={isSw ? 'Funga' : 'Close'}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 sm:p-6 space-y-5">
              {dossierError && <div role="alert" className="border border-red-200 bg-red-50 rounded-lg p-3 text-xs font-semibold text-red-900 flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /><span>{dossierError}</span></div>}
              {dossierLoading ? (
                <div className="py-10 text-sm text-slate-600 inline-flex items-center gap-2"><LoaderCircle className="w-4 h-4 animate-spin" /> {isSw ? 'Inapakia taarifa...' : 'Loading dossier...'}</div>
              ) : dossier ? (
                <>
                  <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-bold text-slate-900">{isSw ? 'Duka & Mawasiliano' : 'Store & Contact'}</h4>
                      <div className="text-xs text-slate-700 space-y-1">
                        <div><span className="font-semibold">{isSw ? 'Biashara' : 'Business'}:</span> {dossier.merchant.merchantName} ({dossier.merchant.tier})</div>
                        <div><span className="font-semibold">{isSw ? 'Mmiliki' : 'Owner'}:</span> {dossier.owner?.fullName || '—'}</div>
                        <div className="inline-flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> <span>{dossier.owner?.phoneE164 || '—'}</span></div>
                        <div><span className="font-semibold">GPS:</span> <span className="font-mono">{Number(dossier.merchant.latitude).toFixed(5)}, {Number(dossier.merchant.longitude).toFixed(5)}</span></div>
                        <div><span className="font-semibold">{isSw ? 'Eneo' : 'Area'}:</span> {dossier.merchant.wardName || dossier.merchant.ward} · {dossier.merchant.district}</div>
                        <div><span className="font-semibold">{isSw ? 'Alama ya mtaa' : 'Landmark'}:</span> {dossier.merchant.streetLandmark || dossier.merchant.streetAddress || '—'}</div>
                        <div><span className="font-semibold">{isSw ? 'Hali ya akaunti' : 'Account status'}:</span> <span className={`font-semibold ${dossier.merchant.accountStatus === 'SUSPENDED' ? 'text-red-700' : 'text-emerald-700'}`}>{dossier.merchant.accountStatus}</span></div>
                        {dossier.merchant.suspensionReason ? <div className="text-red-700"><span className="font-semibold">{isSw ? 'Sababu' : 'Reason'}:</span> {dossier.merchant.suspensionReason}</div> : null}
                      </div>
                    </div>
                    <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-bold text-slate-900">{isSw ? 'Muhtasari wa Shughuli' : 'Activity Summary'}</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-slate-50 border border-slate-200 rounded-md p-3"><div className="text-slate-500 flex items-center gap-1"><Banknote className="w-3.5 h-3.5" /> {isSw ? 'Mauzo Jumla' : 'Total Sales'}</div><div className="font-mono font-bold text-slate-900 mt-1">TZS {Number(dossier.activity?.totalSalesTzs ?? 0).toLocaleString('en-US')}</div></div>
                        <div className="bg-slate-50 border border-slate-200 rounded-md p-3"><div className="text-slate-500 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> {isSw ? 'Oda Zilizokamilika' : 'Orders Completed'}</div><div className="font-mono font-bold text-slate-900 mt-1">{Number(dossier.activity?.ordersCompleted ?? 0).toLocaleString('en-US')}</div></div>
                        <div className="bg-slate-50 border border-slate-200 rounded-md p-3"><div className="text-slate-500">{isSw ? 'Oda Zote' : 'Total Orders'}</div><div className="font-mono font-bold text-slate-900 mt-1">{Number(dossier.activity?.totalOrders ?? 0).toLocaleString('en-US')}</div></div>
                        <div className="bg-slate-50 border border-slate-200 rounded-md p-3"><div className="text-slate-500 flex items-center gap-1"><Package className="w-3.5 h-3.5" /> {isSw ? 'Bidhaa Hai Zilizo Stokini' : 'Active Products in Stock'}</div><div className="font-mono font-bold text-slate-900 mt-1">{Number(dossier.activity?.activeProductsInStock ?? 0).toLocaleString('en-US')}</div></div>
                      </div>
                    </div>
                  </section>

                  <section className="border border-slate-200 rounded-lg p-4 space-y-3">
                    <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-600" /> {isSw ? 'Simamisha / Rejesha Akaunti (Suspend / Reinstate Merchant)' : 'Suspend / Reinstate Merchant'}</h4>
                    <p className="text-xs text-slate-600">{isSw ? 'Kusimamisha huficha bidhaa Sokoni na kuzuia oda mpya. Sababu ni lazima unaposimamisha.' : 'Suspending hides products from Sokoni and blocks new orders. A reason is required when suspending.'}</p>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-slate-700">{isSw ? 'Sababu (lazima ukisimamisha)' : 'Reason (required when suspending)'}</span>
                      <textarea value={dossierSuspendReason} onChange={(e) => setDossierSuspendReason(e.target.value)} rows={3} className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900" placeholder={isSw ? 'Andika sababu ya sera...' : 'Enter policy reason...'} />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" disabled={isSuspending || dossier.merchant.accountStatus === 'SUSPENDED'} onClick={() => void handleSetMerchantStatusFromDossier(true)} className="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md border border-red-200 bg-red-50 text-red-800 hover:bg-red-100 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                        {isSuspending ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                        <span>{isSw ? 'Simamisha Akaunti (Suspend Merchant)' : 'Suspend Merchant'}</span>
                      </button>
                      <button type="button" disabled={isSuspending || dossier.merchant.accountStatus !== 'SUSPENDED'} onClick={() => void handleSetMerchantStatusFromDossier(false)} className="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                        {isSuspending ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                        <span>{isSw ? 'Rejesha Akaunti (Reinstate Merchant)' : 'Reinstate Merchant'}</span>
                      </button>
                    </div>
                  </section>

                  <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-bold text-slate-900">{isSw ? 'Migogoro / Malalamiko (Disputes)' : 'Dispute History'}</h4>
                      {(dossier.disputeHistory || []).length === 0 ? <p className="text-xs text-slate-500">{isSw ? 'Hakuna migogoro iliyorekodiwa.' : 'No disputes recorded.'}</p> : (
                        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                          {dossier.disputeHistory.map((d: any) => (
                            <div key={d.ledgerId} className="text-xs border border-amber-200 bg-amber-50 rounded-md p-2.5">
                              <div className="font-semibold text-slate-900">ODA {d.orderRef || d.orderId} · {d.verificationStatus}</div>
                              <div className="text-slate-700 mt-0.5">{d.discrepancyReason || (isSw ? 'Hakuna maelezo' : 'No details')}</div>
                              <div className="font-mono text-slate-600 mt-0.5">TZS {Number(d.expectedAmountTzs || 0).toLocaleString('en-US')} / {Number(d.collectedAmountTzs || 0).toLocaleString('en-US')}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                      <h4 className="text-sm font-bold text-slate-900">{isSw ? 'Kumbukumbu za Ukaguzi (Audit)' : 'Audit History'}</h4>
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {[...(dossier.auditHistory?.security || []), ...(dossier.auditHistory?.financial || [])].slice(0, 20).map((a: any, idx: number) => (
                          <div key={a.id || idx} className="text-xs border border-slate-200 bg-slate-50 rounded-md p-2.5">
                            <div className="font-semibold text-slate-900">{a.eventType}</div>
                            <div className="text-slate-600 mt-0.5">{a.createdAt ? new Date(a.createdAt).toLocaleString() : '—'}</div>
                          </div>
                        ))}
                        {((dossier.auditHistory?.security || []).length + (dossier.auditHistory?.financial || []).length) === 0 && <p className="text-xs text-slate-500">{isSw ? 'Hakuna kumbukumbu za ukaguzi.' : 'No audit records.'}</p>}
                      </div>
                    </div>
                  </section>
                </>
              ) : <p className="text-sm text-slate-600">{isSw ? 'Hakuna taarifa.' : 'No dossier data.'}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
