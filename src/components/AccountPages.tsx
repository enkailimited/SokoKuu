import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Languages,
  LoaderCircle,
  LogOut,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  User,
  WifiOff,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { useDataSaver } from '../context/DataSaverContext';
import {
  MODE_LABELS,
  ROLE_LABELS,
  type AccountMode,
  type UserProfile,
} from '../types/auth';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { ImageKitUpload } from './ImageKitUpload';

interface SupplierDeliveryPolicyState {
  isFreeDeliveryEnabled: boolean;
  freeDeliveryMinOrderTzs: string;
  standardDeliveryFeeTzs: string;
  deliveryCoverageRegions: string[];
  allowAdminReceive?: boolean;
}

function describeSettingsError(err: unknown, isSw: boolean, fallback: string): string {
  if (err instanceof SokoHttpError) return `HTTP ${err.status}: ${err.message}`;
  if (isSokoNetworkError(err)) {
    return isSw
      ? 'Hakuna muunganisho na SokoKuu API; hakuna data ya demo inayotumika.'
      : 'SokoKuu API is unreachable; no demo data is being substituted.';
  }
  return err instanceof Error ? err.message : fallback;
}

export function ProfileEditView({
  locale,
  profile,
  onSaveProfile,
  onBackToDashboard,
  onLogout,
}: {
  locale: Locale;
  profile: UserProfile;
  onSaveProfile: (updated: UserProfile) => void;
  onBackToDashboard: () => void;
  onLogout?: () => void;
}) {
  const isSw = locale === 'sw';
  const [form, setForm] = useState<UserProfile>(profile);
  const [savedNotice, setSavedNotice] = useState(false);
  const [savingShopImage, setSavingShopImage] = useState(false);
  const [shopImageNotice, setShopImageNotice] = useState<string | null>(null);
  const [shopImageError, setShopImageError] = useState<string | null>(null);
  const canManageShopImage =
    profile.role === 'RETAILER' ||
    profile.role === 'WHOLESALER' ||
    profile.role === 'SUPPLIER';

  const handleSaveShopImage = async () => {
    setShopImageNotice(null);
    setShopImageError(null);
    const logoCdnUrl = (form.shopImageUrl ?? '').trim();
    if (!logoCdnUrl) {
      setShopImageError(
        isSw ? 'Chagua picha ya duka kwanza.' : 'Choose a shop image first.',
      );
      return;
    }
    setSavingShopImage(true);
    try {
      const res = await SokoApiClient.patch<{
        merchantId: string;
        logoCdnUrl: string;
      }>('/auth/me/merchant-image', { logoCdnUrl });
      const updated: UserProfile = { ...form, shopImageUrl: res.logoCdnUrl };
      setForm(updated);
      onSaveProfile(updated);
      setShopImageNotice(
        isSw ? 'Picha ya duka imehifadhiwa.' : 'Shop image saved.',
      );
    } catch (err) {
      if (err instanceof SokoHttpError) {
        setShopImageError(`HTTP ${err.status}: ${err.message}`);
      } else if (isSokoNetworkError(err)) {
        setShopImageError(
          isSw
            ? 'Hakuna muunganisho na SokoKuu API. Jaribu tena.'
            : 'SokoKuu API is unreachable. Try again.',
        );
      } else {
        setShopImageError(
          err instanceof Error ? err.message : isSw ? 'Imeshindikana.' : 'Failed.',
        );
      }
    } finally {
      setSavingShopImage(false);
    }
  };

  const allowedModesForRole = (): AccountMode[] => {
    switch (profile.role) {
      case 'WHOLESALER':
        return ['WHOLESALE', 'HYBRID_STORE'];
      case 'RETAILER':
        return ['RETAIL_DUKA'];
      case 'CONSUMER':
        return ['END_CONSUMER'];
      case 'DRIVER':
        return ['FLEET_RIDER'];
      case 'SUPPLIER':
        return ['MANUFACTURER_SUPPLIER'];
      case 'SUPER_ADMIN':
        return ['PLATFORM_ADMIN'];
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile(form);
    setSavedNotice(true);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onBackToDashboard}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isSw ? 'Rudi kwenye Dashibodi' : 'Back to Dashboard'}</span>
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {isSw ? 'Wasifu Wangu & Maelezo ya Akaunti' : 'My Profile & Account Details'}
          </h1>
          <p className="text-xs text-slate-500">
            {isSw ? ROLE_LABELS[profile.role].sw : ROLE_LABELS[profile.role].en} ·{' '}
            {isSw ? MODE_LABELS[form.mode].sw : MODE_LABELS[form.mode].en}
          </p>
        </div>
      </div>

      {savedNotice && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 flex items-center gap-2.5 text-xs font-semibold text-emerald-900"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          <span>
            {isSw
              ? 'Mapendeleo ya kikao chako yamehifadhiwa.'
              : 'Your session display preferences have been updated.'}
          </span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              <span>{isSw ? 'Jina Kamili' : 'Full Name'}</span>
            </span>
            <input
              type="text"
              readOnly
              value={form.fullName}
              className="w-full min-h-[44px] px-3.5 text-sm bg-slate-50 border border-slate-200 rounded-md text-slate-700"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              <span>{isSw ? 'Namba ya Simu (NextSMS)' : 'Phone Number (SMS)'}</span>
            </span>
            <input
              type="tel"
              readOnly
              value={form.phone}
              className="w-full min-h-[44px] px-3.5 text-sm font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-700"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Jina la Biashara / Kitambulisho' : 'Merchant / Account Label'}
            </span>
            <input
              type="text"
              readOnly
              value={form.businessLabel}
              className="w-full min-h-[44px] px-3.5 text-sm bg-slate-50 border border-slate-200 rounded-md text-slate-700"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              <span>{isSw ? 'Kata / Mtaa (PostgreSQL)' : 'Ward / Address'}</span>
            </span>
            <input
              type="text"
              value={form.ward}
              onChange={(e) => {
                setForm((p) => ({ ...p, ward: e.target.value }));
                setSavedNotice(false);
              }}
              placeholder={isSw ? 'Weka kata yako...' : 'Enter ward...'}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>
        </div>

        <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              <span>{isSw ? 'Hali ya Akaunti (Mode)' : 'Assigned Account Mode'}</span>
            </span>
            <select
              value={form.mode}
              disabled={allowedModesForRole().length <= 1}
              onChange={(e) => {
                setForm((p) => ({ ...p, mode: e.target.value as AccountMode }));
                setSavedNotice(false);
              }}
              className="w-full min-h-[44px] px-3 text-xs bg-white border border-slate-300 rounded-md text-slate-900 disabled:bg-slate-50 disabled:text-slate-600"
            >
              {allowedModesForRole().map((m) => (
                <option key={m} value={m}>
                  {isSw ? MODE_LABELS[m].sw : MODE_LABELS[m].en}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 block">
              {isSw ? 'ID ya Mtumiaji & Biashara' : 'User & Merchant UUID'}
            </span>
            <div className="min-h-[44px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-[11px] font-mono text-slate-600 break-all">
              UID: {profile.userId}
              {profile.businessId ? ` · BID: ${profile.businessId}` : ''}
            </div>
          </div>
        </div>

        {canManageShopImage && (
          <div className="border border-slate-200 bg-slate-50/70 rounded-lg p-4 space-y-3">
            <div className="text-xs font-semibold text-slate-800">
              {isSw ? 'Picha ya Duka (SokoKuu / ImageKit)' : 'Shop Image (SokoKuu / ImageKit)'}
            </div>
            <div className="flex flex-wrap items-start gap-4">
              <ImageKitUpload
                locale={locale}
                value={form.shopImageUrl ?? ''}
                onChange={(url) => {
                  setForm((p) => ({ ...p, shopImageUrl: url }));
                  setShopImageNotice(null);
                  setShopImageError(null);
                }}
                folder="/merchants"
                label={isSw ? 'Picha ya duka' : 'Shop image'}
              />
              <div className="flex-1 min-w-[200px] space-y-2">
                <p className="text-[11px] text-slate-600">
                  {isSw
                    ? 'Pakia picha ya duka lako. Picha inaonyeshwa kwenye orodha ya wauzaji wa sokoni.'
                    : 'Upload your shop image. It appears on marketplace merchant cards and hubs.'}
                </p>
                {shopImageNotice && (
                  <div className="text-[11px] font-semibold text-emerald-700">
                    {shopImageNotice}
                  </div>
                )}
                {shopImageError && (
                  <div className="text-[11px] font-semibold text-red-700">
                    {shopImageError}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void handleSaveShopImage()}
                  disabled={savingShopImage || !(form.shopImageUrl ?? '').trim()}
                  className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {savingShopImage ? (
                    <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>{isSw ? 'Hifadhi Picha ya Duka' : 'Save Shop Image'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="min-h-[44px] px-4 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-4 h-4 text-red-600" aria-hidden="true" />
                <span>{isSw ? 'Ondoka (Logout)' : 'Logout'}</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <button
              type="button"
              onClick={onBackToDashboard}
              className="min-h-[44px] px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
            >
              {isSw ? 'Funga' : 'Close'}
            </button>
            <button
              type="submit"
              className="min-h-[44px] px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md inline-flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              <span>{isSw ? 'Hifadhi Mapendeleo' : 'Save Preferences'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function SettingsView({
  locale,
  onSetLocale,
  profile,
  onSaveProfile,
  onBackToDashboard,
}: {
  locale: Locale;
  onSetLocale: (loc: Locale) => void;
  profile: UserProfile;
  onSaveProfile: (updated: UserProfile) => void;
  onBackToDashboard: () => void;
}) {
  const isSw = locale === 'sw';
  const { isLowDataModeActive, toggleLowDataMode } = useDataSaver();
  const [savedFlag, setSavedFlag] = useState(false);

  const togglePref = (field: 'smsAlertsEnabled' | 'offlineSmsFallbackEnabled') => {
    onSaveProfile({ ...profile, [field]: !profile[field] });
    setSavedFlag(true);
  };

  const isMerchantFreeDelivery =
    profile.role === 'WHOLESALER' || profile.role === 'RETAILER';
  const isSupplierFreeDelivery = profile.role === 'SUPPLIER';
  const showsFreeDelivery = isMerchantFreeDelivery || isSupplierFreeDelivery;

  const [freeDeliveryEnabled, setFreeDeliveryEnabled] = useState(false);
  const [supplierDeliveryPolicy, setSupplierDeliveryPolicy] =
    useState<SupplierDeliveryPolicyState | null>(null);
  const [freeDeliveryLoading, setFreeDeliveryLoading] = useState(showsFreeDelivery);
  const [freeDeliverySaving, setFreeDeliverySaving] = useState(false);
  const [freeDeliveryError, setFreeDeliveryError] = useState<string | null>(null);

  // Explicit, revocable consent for the Super Admin helpdesk to receive Supplier orders.
  const [allowAdminReceive, setAllowAdminReceive] = useState(false);
  const [adminReceiveSaving, setAdminReceiveSaving] = useState(false);

  useEffect(() => {
    if (!showsFreeDelivery) return;
    let active = true;
    setFreeDeliveryLoading(true);
    setFreeDeliveryError(null);

    const load = async () => {
      try {
        if (isSupplierFreeDelivery) {
          const res = await SokoApiClient.get<SupplierDeliveryPolicyState>(
            '/supplier/delivery-settings',
          );
          if (!active) return;
          setSupplierDeliveryPolicy(res);
          setFreeDeliveryEnabled(Boolean(res.isFreeDeliveryEnabled));
          setAllowAdminReceive(Boolean(res.allowAdminReceive));
        } else {
          const query = profile.businessId
            ? `?businessId=${encodeURIComponent(profile.businessId)}`
            : '';
          const res = await SokoApiClient.get<{ offersFreeDelivery: boolean }>(
            `/merchant/market-settings${query}`,
          );
          if (!active) return;
          setFreeDeliveryEnabled(Boolean(res.offersFreeDelivery));
        }
      } catch (err) {
        if (active) {
          setFreeDeliveryError(
            describeSettingsError(
              err,
              isSw,
              isSw
                ? 'Imeshindikana kupakia mpangilio wa Free Delivery.'
                : 'Failed to load the Free Delivery setting.',
            ),
          );
        }
      } finally {
        if (active) setFreeDeliveryLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [isSupplierFreeDelivery, isSw, profile.businessId, showsFreeDelivery]);

  const handleToggleFreeDelivery = async () => {
    setFreeDeliveryError(null);
    setFreeDeliverySaving(true);
    try {
      if (isSupplierFreeDelivery) {
        if (!supplierDeliveryPolicy) {
          throw new Error(
            isSw
              ? 'Sera ya usafiri ya supplier bado haijapakia.'
              : 'Supplier delivery policy has not loaded yet.',
          );
        }
        const res = await SokoApiClient.patch<SupplierDeliveryPolicyState>(
          '/supplier/delivery-settings',
          {
            isFreeDeliveryEnabled: !freeDeliveryEnabled,
            freeDeliveryMinOrderTzs: supplierDeliveryPolicy.freeDeliveryMinOrderTzs,
            standardDeliveryFeeTzs: supplierDeliveryPolicy.standardDeliveryFeeTzs,
            deliveryCoverageRegions: supplierDeliveryPolicy.deliveryCoverageRegions,
          },
        );
        setSupplierDeliveryPolicy(res);
        setFreeDeliveryEnabled(Boolean(res.isFreeDeliveryEnabled));
        if (typeof res.allowAdminReceive === 'boolean') {
          setAllowAdminReceive(res.allowAdminReceive);
        }
      } else {
        const res = await SokoApiClient.patch<{ offersFreeDelivery: boolean }>(
          '/merchant/market-settings/free-delivery',
          { offersFreeDelivery: !freeDeliveryEnabled },
        );
        setFreeDeliveryEnabled(Boolean(res.offersFreeDelivery));
      }
      setSavedFlag(true);
      // Supplier dashboard shows this as a read-only badge — keep it in sync.
      window.dispatchEvent(new CustomEvent('sokokuu:free-delivery-updated'));
    } catch (err) {
      setFreeDeliveryError(
        describeSettingsError(
          err,
          isSw,
          isSw
            ? 'Imeshindikana kuhifadhi mpangilio wa Free Delivery.'
            : 'Failed to save the Free Delivery setting.',
        ),
      );
    } finally {
      setFreeDeliverySaving(false);
    }
  };

  const handleToggleAdminReceive = async () => {
    setFreeDeliveryError(null);
    setAdminReceiveSaving(true);
    try {
      const res = await SokoApiClient.patch<{ allowAdminReceive: boolean }>(
        '/supplier/admin-receive',
        { allowAdminReceive: !allowAdminReceive }
      );
      setAllowAdminReceive(Boolean(res.allowAdminReceive));
      setSavedFlag(true);
      window.dispatchEvent(new CustomEvent('sokokuu:free-delivery-updated'));
    } catch (err) {
      setFreeDeliveryError(
        describeSettingsError(
          err,
          isSw,
          isSw
            ? 'Imeshindikana kuhifadhi ruhusa ya kupokea oda na admin.'
            : 'Failed to save the admin order-receiving consent.'
        )
      );
    } finally {
      setAdminReceiveSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="space-y-1 border-b border-slate-100 pb-4">
        <button
          type="button"
          onClick={onBackToDashboard}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{isSw ? 'Rudi kwenye Dashibodi' : 'Back to Dashboard'}</span>
        </button>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {isSw ? 'Mipangilio ya Mfumo (Settings)' : 'Account & Platform Settings'}
        </h1>
        <p className="text-xs text-slate-500">
          {profile.fullName} · {profile.businessLabel}
        </p>
      </div>

      {savedFlag && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-3.5 flex items-center gap-2 text-xs font-semibold text-emerald-900"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
          <span>{isSw ? 'Mipangilio imesasishwa.' : 'Preferences updated.'}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Languages className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {isSw ? 'Lugha ya Jukwaa' : 'Platform Language'}
              </div>
              <div className="text-xs text-slate-500">
                {isSw
                  ? 'Badilisha kati ya Kiswahili na Kiingereza (hufanya kazi hata bila intaneti).'
                  : 'Switch between Tanzanian Swahili and English offline dictionaries.'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => onSetLocale('sw')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                locale === 'sw' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Kiswahili
            </button>
            <button
              type="button"
              onClick={() => onSetLocale('en')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                locale === 'en' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              English
            </button>
          </div>
        </div>

        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <WifiOff className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {isSw ? 'Hali ya Kubana Data (Low-Data Mode)' : 'Low-Data Bundle Mode'}
              </div>
              <div className="text-xs text-slate-500">
                {isSw
                  ? 'Huzuia kupakua picha kubwa za bidhaa ili kuokoa kifurushi cha simu.'
                  : 'Suppresses heavy product imagery on 2G/3G networks to conserve mobile bundles.'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleLowDataMode}
            className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md border cursor-pointer whitespace-nowrap ${
              isLowDataModeActive
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {isLowDataModeActive ? (isSw ? 'IMEWASHWA' : 'ENABLED') : isSw ? 'IMEZIMWA' : 'DISABLED'}
          </button>
        </div>

        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <SlidersHorizontal className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {isSw ? 'Arifa za SMS (Oda & PIN)' : 'SMS Dispatch & PIN Alerts'}
              </div>
              <div className="text-xs text-slate-500">
                {isSw
                  ? `Tuma arifa za makabidhiano kwenda ${profile.phone}.`
                  : `Deliver CoD order & Dual-PIN confirmation SMS to ${profile.phone}.`}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => togglePref('smsAlertsEnabled')}
            className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md border cursor-pointer whitespace-nowrap ${
              profile.smsAlertsEnabled
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {profile.smsAlertsEnabled
              ? isSw
                ? 'IMEWASHWA'
                : 'ENABLED'
              : isSw
                ? 'IMEZIMWA'
                : 'DISABLED'}
          </button>
        </div>

        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {isSw ? 'Njia Mbadala ya SMS Nje ya Mtandao' : 'Automatic Offline SMS Fallback'}
              </div>
              <div className="text-xs text-slate-500">
                {isSw
                  ? 'Mtandao ukikata, tumia ujumbe mfupi uliosainiwa kwa WebCrypto HMAC.'
                  : 'Automatically switches checkout CTA to HMAC-signed 160-char NextSMS offline.'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => togglePref('offlineSmsFallbackEnabled')}
            className={`min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md border cursor-pointer whitespace-nowrap ${
              profile.offlineSmsFallbackEnabled
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {profile.offlineSmsFallbackEnabled
              ? isSw
                ? 'IMEWASHWA'
                : 'ENABLED'
              : isSw
                ? 'IMEZIMWA'
                : 'DISABLED'}
          </button>
        </div>

        {showsFreeDelivery && (
          <div className="p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3 max-w-2xl">
              <Truck className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-900">
                  {isSw ? 'Usafiri wa Bure (Free Delivery)' : 'Free Delivery'}
                </div>
                <p className="text-xs text-slate-500">
                  {isSw
                    ? 'Ikiwashwa, wateja wanaona usafiri wa bure kwenye duka lako na bei ya usafiri inakuwa TZS 0 kwenye oda mpya.'
                    : 'When enabled, buyers see free delivery on your storefront and new orders are quoted at TZS 0 delivery.'}
                </p>
                {isSupplierFreeDelivery && supplierDeliveryPolicy && (
                  <p className="text-[11px] font-mono text-slate-600">
                    {isSw ? 'Kiwango cha chini' : 'Threshold'}: TZS{' '}
                    {Number(supplierDeliveryPolicy.freeDeliveryMinOrderTzs).toLocaleString('en-US')}{' '}
                    · {isSw ? 'Ada ya kawaida' : 'Standard fee'}: TZS{' '}
                    {Number(supplierDeliveryPolicy.standardDeliveryFeeTzs).toLocaleString('en-US')}{' '}
                    · {supplierDeliveryPolicy.deliveryCoverageRegions.join(', ')}
                  </p>
                )}
                {freeDeliveryError && (
                  <div
                    role="alert"
                    className="mt-2 border border-red-200 bg-red-50 rounded-md px-3 py-2 text-[11px] font-medium text-red-900 inline-flex items-start gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{freeDeliveryError}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span
                role="status"
                aria-live="polite"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold uppercase tracking-wide whitespace-nowrap ${
                  freeDeliveryEnabled
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-slate-100 border-slate-200 text-slate-600'
                }`}
              >
                {freeDeliveryLoading || freeDeliverySaving ? (
                  <LoaderCircle className="w-3 h-3 animate-spin" aria-hidden="true" />
                ) : (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      freeDeliveryEnabled ? 'bg-emerald-600' : 'bg-slate-400'
                    }`}
                  />
                )}
                <span>
                  {freeDeliveryLoading
                    ? isSw ? 'Inapakia...' : 'Loading...'
                    : freeDeliverySaving
                      ? isSw ? 'Inahifadhi...' : 'Saving...'
                      : freeDeliveryEnabled
                        ? isSw ? 'IMEWASHWA' : 'ENABLED'
                        : isSw ? 'IMEZIMWA' : 'DISABLED'}
                </span>
              </span>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  role="switch"
                  checked={freeDeliveryEnabled}
                  disabled={freeDeliveryLoading || freeDeliverySaving || !SokoApiClient.hasAccessToken()}
                  onChange={() => void handleToggleFreeDelivery()}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={`relative w-9 h-5 rounded-full transition-colors ${
                    freeDeliveryEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      freeDeliveryEnabled ? 'translate-x-4' : ''
                    }`}
                  />
                </span>
                <span className="text-[11px] text-slate-500">
                  {isSw ? 'Badilisha' : 'Toggle'}
                </span>
              </label>
            </div>
          </div>
        )}

        {isSupplierFreeDelivery && (
          <div className="p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3 max-w-2xl">
              <ShieldCheck className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-900">
                  {isSw
                    ? 'Ruhusa ya Admin Kupokea Oda za Supplier'
                    : 'Admin Receiving of Supplier Orders'}
                </div>
                <p className="text-xs text-slate-500">
                  {isSw
                    ? 'Ukikubali, dawati la msaada la msimamizi linaweza kupokea na kusafirisha oda zako za B2B. Ruhusa hii inaweza kutenguliwa wakati wowote.'
                    : 'When enabled, the Super Admin helpdesk may receive and transit your B2B orders. You can revoke this consent at any time.'}
                </p>
                {freeDeliveryError && (
                  <div
                    role="alert"
                    className="mt-2 border border-red-200 bg-red-50 rounded-md px-3 py-2 text-[11px] font-medium text-red-900 inline-flex items-start gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{freeDeliveryError}</span>
                  </div>
                )}
              </div>
            </div>

            <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
              <input
                type="checkbox"
                role="switch"
                checked={allowAdminReceive}
                disabled={freeDeliveryLoading || adminReceiveSaving}
                onChange={() => void handleToggleAdminReceive()}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={`relative w-9 h-5 rounded-full transition-colors ${
                  allowAdminReceive ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    allowAdminReceive ? 'translate-x-4' : ''
                  }`}
                />
              </span>
              <span className="text-[11px] text-slate-500">
                {adminReceiveSaving
                  ? isSw ? 'Inahifadhi...' : 'Saving...'
                  : allowAdminReceive
                    ? isSw ? 'Imewashwa' : 'Enabled'
                    : isSw ? 'Imezimwa' : 'Disabled'}
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
