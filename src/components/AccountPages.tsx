import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Languages,
  LoaderCircle,
  LocateFixed,
  Lock,
  LogOut,
  MapPin,
  Navigation,
  Phone,
  Plus,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Truck,
  User,
  WifiOff,
} from 'lucide-react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});
import type { Locale } from '../data/i18n';
import { useDataSaver } from '../context/DataSaverContext';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { PWAInstallButton } from './PWAInstallButton';
import {
  MODE_LABELS,
  ROLE_LABELS,
  mapTierToAccountMode,
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
  const [form, setForm] = useState<UserProfile>({
    ...profile,
    district: profile.district ?? '',
    preferredLocale: profile.preferredLocale ?? locale,
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [savingShopImage, setSavingShopImage] = useState(false);
  const [shopImageNotice, setShopImageNotice] = useState<string | null>(null);
  const [shopImageError, setShopImageError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const canManageShopImage =
    profile.role === 'RETAILER' ||
    profile.role === 'WHOLESALER' ||
    profile.role === 'SUPPLIER' ||
    (profile.role as string) === 'MANUFACTURER_SUPPLIER';

  const canManageMerchantLocation =
    profile.role === 'RETAILER' ||
    profile.role === 'WHOLESALER' ||
    profile.role === 'SUPPLIER' ||
    (profile.role as string) === 'MANUFACTURER_SUPPLIER';

  type MerchantRouteWaypoint = { step: number; label: string; hint: string; lat?: number | null; lng?: number | null };
  const [merchantLocation, setMerchantLocation] = useState<{
    latitude: number;
    longitude: number;
    wardName: string;
    streetLandmark: string;
    routeWaypoints: MerchantRouteWaypoint[];
  } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const loadMerchantLocation = useCallback(async () => {
    if (!canManageMerchantLocation || !SokoApiClient.hasAccessToken()) return;
    setLocationLoading(true);
    setLocationError(null);
    try {
      const res = await SokoApiClient.get<any>('/merchant/profile/location');
      setMerchantLocation({
        latitude: Number(res.latitude ?? 0),
        longitude: Number(res.longitude ?? 0),
        wardName: String(res.wardName ?? res.ward ?? ''),
        streetLandmark: String(res.streetLandmark ?? res.streetAddress ?? ''),
        routeWaypoints: Array.isArray(res.routeWaypoints)
          ? res.routeWaypoints.map((w: any, i: number) => ({
              step: typeof w?.step === 'number' ? w.step : i + 1,
              label: String(w?.label ?? ''),
              hint: String(w?.hint ?? ''),
              lat: typeof w?.lat === 'number' ? w.lat : w?.lat != null && w?.lat !== '' ? Number(w.lat) : null,
              lng: typeof w?.lng === 'number' ? w.lng : w?.lng != null && w?.lng !== '' ? Number(w.lng) : null,
            }))
          : [],
      });
    } catch (err) {
      // Not fatal for profile page; show inline
      if (!isSokoNetworkError(err)) {
        setLocationError(
          err instanceof SokoHttpError ? `HTTP ${err.status}: ${err.message}` : err instanceof Error ? err.message : String(err),
        );
      }
    } finally {
      setLocationLoading(false);
    }
  }, [canManageMerchantLocation]);

  useEffect(() => {
    void loadMerchantLocation();
  }, [loadMerchantLocation]);

  const handleUseCurrentLocation = () => {
    setLocationNotice(null);
    setLocationError(null);
    if (!('geolocation' in navigator)) {
      setLocationError(isSw ? 'Kifaa hakina GPS.' : 'Geolocation is unavailable on this device.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMerchantLocation((prev) => ({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          wardName: prev?.wardName ?? '',
          streetLandmark: prev?.streetLandmark ?? '',
          routeWaypoints: prev?.routeWaypoints ?? [],
        }));
        setLocationNotice(isSw ? 'Eneo la sasa limechukuliwa. Hifadhi ili kusasisha ramani.' : 'Current location captured. Save to update map pin.');
        setLocating(false);
      },
      () => {
        setLocationError(isSw ? 'Imeshindikana kupata eneo la sasa.' : 'Failed to get current location.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  };

  const handleSaveMerchantLocation = async () => {
    if (!merchantLocation) return;
    setLocationSaving(true);
    setLocationError(null);
    setLocationNotice(null);
    try {
      const payload = {
        latitude: Number(merchantLocation.latitude),
        longitude: Number(merchantLocation.longitude),
        wardName: (merchantLocation.wardName || '').trim(),
        streetLandmark: (merchantLocation.streetLandmark || '').trim(),
        routeWaypoints: (merchantLocation.routeWaypoints || [])
          .map((w, i) => ({
            step: i + 1,
            label: String(w.label || '').trim(),
            hint: String(w.hint || '').trim(),
            ...(typeof w.lat === 'number' && !Number.isNaN(w.lat) ? { lat: w.lat } : {}),
            ...(typeof w.lng === 'number' && !Number.isNaN(w.lng) ? { lng: w.lng } : {}),
          }))
          .filter((w) => w.label || w.hint),
      };
      const res = await SokoApiClient.patch<any>('/merchant/profile/location', payload);
      setMerchantLocation({
        latitude: Number(res.latitude ?? payload.latitude),
        longitude: Number(res.longitude ?? payload.longitude),
        wardName: String(res.wardName ?? payload.wardName ?? ''),
        streetLandmark: String(res.streetLandmark ?? payload.streetLandmark ?? ''),
        routeWaypoints: Array.isArray(res.routeWaypoints)
          ? res.routeWaypoints.map((w: any, i: number) => ({
              step: typeof w?.step === 'number' ? w.step : i + 1,
              label: String(w?.label ?? ''),
              hint: String(w?.hint ?? ''),
              lat: typeof w?.lat === 'number' ? w.lat : null,
              lng: typeof w?.lng === 'number' ? w.lng : null,
            }))
          : payload.routeWaypoints,
      });
      setLocationNotice(isSw ? 'Mahali pa duka na alama za njia vimehifadhiwa.' : 'Store location and route markers saved.');
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setLocationError(isSw ? 'Hakuna muunganisho na SokoKuu API.' : 'SokoKuu API is unreachable.');
      } else {
        setLocationError(
          err instanceof SokoHttpError ? `HTTP ${err.status}: ${err.message}` : err instanceof Error ? err.message : 'Failed to save location.',
        );
      }
    } finally {
      setLocationSaving(false);
    }
  };

  const addRouteWaypoint = () => {
    setMerchantLocation((prev) => {
      if (!prev) return prev;
      const nextStep = (prev.routeWaypoints?.length ?? 0) + 1;
      return {
        ...prev,
        routeWaypoints: [
          ...(prev.routeWaypoints ?? []),
          { step: nextStep, label: '', hint: '', lat: null, lng: null },
        ],
      };
    });
  };

  const updateRouteWaypoint = (index: number, patch: Partial<MerchantRouteWaypoint>) => {
    setMerchantLocation((prev) => {
      if (!prev) return prev;
      const list = [...(prev.routeWaypoints ?? [])];
      list[index] = { ...list[index], ...patch };
      return { ...prev, routeWaypoints: list.map((w, i) => ({ ...w, step: i + 1 })) };
    });
  };

  const removeRouteWaypoint = (index: number) => {
    setMerchantLocation((prev) => {
      if (!prev) return prev;
      const list = [...(prev.routeWaypoints ?? [])];
      list.splice(index, 1);
      return { ...prev, routeWaypoints: list.map((w, i) => ({ ...w, step: i + 1 })) };
    });
  };

  useEffect(() => {
    setForm({
      ...profile,
      district: profile.district ?? '',
      preferredLocale: profile.preferredLocale ?? locale,
    });
  }, [profile, locale]);

  const handleSaveShopImage = async () => {
    setShopImageNotice(null);
    setShopImageError(null);
    const logoCdnUrl = (form.shopImageUrl ?? '').trim();
    if (!logoCdnUrl) {
      setShopImageError(
        isSw ? 'Chagua picha ya duka kwanza.' : 'Choose a merchant image first.',
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
        isSw ? 'Picha ya Mfanyabiashara imehifadhiwa.' : 'Merchant image saved.',
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
      case 'SALES_STAFF':
        return ['SALES_WORKSPACE'];
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileNotice(null);
    setProfileError(null);
    setSavingProfile(true);
    try {
      const payload = {
        fullName: form.fullName.trim(),
        businessName: form.businessLabel.trim(),
        ward: form.ward.trim(),
        district: (form.district ?? '').trim(),
        streetAddress: form.streetAddress.trim(),
        preferredLocale: form.preferredLocale ?? locale,
      };
      const res = await SokoApiClient.patch<{
        user?: {
          id?: string;
          phoneE164?: string;
          fullName?: string;
          role?: UserProfile['role'];
          preferredLocale?: string;
          preferredLanguage?: string;
        };
        businessProfile?: {
          id?: string;
          smsShortCode?: string;
          businessName?: string;
          tier?: string | null;
          ward?: string;
          district?: string;
          streetAddress?: string;
          geospatialMapEnabled?: boolean;
          isPlatformManaged?: boolean;
          logoCdnUrl?: string | null;
        } | null;
        tenantContext?: {
          businessId?: string | null;
          tier?: string | null;
        } | null;
      }>('/auth/me', payload);

      const bp = res.businessProfile;
      const role = res.user?.role ?? form.role;
      const tier = bp?.tier ?? res.tenantContext?.tier ?? form.tier ?? null;
      const updated: UserProfile = {
        ...form,
        userId: res.user?.id ?? form.userId,
        businessId: bp?.id ?? res.tenantContext?.businessId ?? form.businessId ?? null,
        smsShortCode: bp?.smsShortCode ?? form.smsShortCode ?? null,
        tier,
        geospatialMapEnabled:
          typeof bp?.geospatialMapEnabled === 'boolean'
            ? bp.geospatialMapEnabled
            : form.geospatialMapEnabled,
        isPlatformManaged:
          typeof bp?.isPlatformManaged === 'boolean'
            ? bp.isPlatformManaged
            : form.isPlatformManaged,
        fullName: res.user?.fullName ?? form.fullName,
        phone: res.user?.phoneE164 ?? form.phone,
        businessLabel: bp?.businessName ?? form.businessLabel,
        ward: bp?.ward ?? form.ward,
        district: bp?.district ?? form.district ?? '',
        streetAddress: bp?.streetAddress ?? form.streetAddress,
        shopImageUrl: bp?.logoCdnUrl ?? form.shopImageUrl ?? null,
        role,
        mode: mapTierToAccountMode(role, tier),
        preferredLocale:
          ((res.user?.preferredLanguage ?? res.user?.preferredLocale) as Locale | undefined) ??
          (form.preferredLocale as Locale | undefined) ??
          locale,
        preferredLanguage:
          ((res.user?.preferredLanguage ?? res.user?.preferredLocale) as Locale | undefined) ??
          (form.preferredLocale as Locale | undefined) ??
          locale,
      };
      setForm(updated);
      onSaveProfile(updated);
      setProfileNotice(
        isSw
          ? 'Wasifu wako umehifadhiwa kikamilifu.'
          : 'Your profile has been saved successfully.',
      );
    } catch (err) {
      if (err instanceof SokoHttpError) {
        setProfileError(err.message);
      } else if (isSokoNetworkError(err)) {
        setProfileError(
          isSw
            ? 'Hakuna muunganisho na SokoKuu API. Jaribu tena.'
            : 'SokoKuu API is unreachable. Try again.',
        );
      } else {
        setProfileError(
          err instanceof Error ? err.message : isSw ? 'Imeshindikana kuhifadhi.' : 'Save failed.',
        );
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordNotice(null);
    setPasswordError(null);

    if (newPassword.length < 8) {
      setPasswordError(
        isSw
          ? 'Nywila mpya lazima iwe na angalau herufi 8.'
          : 'New password must be at least 8 characters long.',
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(
        isSw ? 'Nywila mpya hazifanani.' : 'New passwords do not match.',
      );
      return;
    }

    setChangingPassword(true);
    try {
      await SokoApiClient.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      setPasswordNotice(
        isSw
          ? 'Nywila imebadilishwa. Tafadhali ingia tena.'
          : 'Password changed. Please sign in again.',
      );
      SokoApiClient.clearTokens();
      if (onLogout) {
        void onLogout();
      } else {
        window.dispatchEvent(new CustomEvent('sokokuu:auth-required'));
      }
    } catch (err) {
      if (err instanceof SokoHttpError) {
        setPasswordError(err.message);
      } else if (isSokoNetworkError(err)) {
        setPasswordError(
          isSw
            ? 'Hakuna muunganisho na SokoKuu API. Jaribu tena.'
            : 'SokoKuu API is unreachable. Try again.',
        );
      } else {
        setPasswordError(
          err instanceof Error
            ? err.message
            : isSw
              ? 'Imeshindikana kubadilisha nywila.'
              : 'Failed to change password.',
        );
      }
    } finally {
      setChangingPassword(false);
    }
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

      {profileNotice && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-4 flex items-center gap-2.5 text-xs font-semibold text-emerald-900"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          <span>{profileNotice}</span>
        </div>
      )}
      {profileError && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg p-4 flex items-center gap-2.5 text-xs font-semibold text-red-900"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
          <span>{profileError}</span>
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
              required
              value={form.fullName}
              onChange={(e) => {
                setForm((p) => ({ ...p, fullName: e.target.value }));
                setProfileNotice(null);
                setProfileError(null);
              }}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
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
              {isSw ? 'Jina la Biashara (Mfanyabiashara)' : 'Merchant Business Name'}
            </span>
            <input
              type="text"
              value={form.businessLabel}
              onChange={(e) => {
                setForm((p) => ({ ...p, businessLabel: e.target.value }));
                setProfileNotice(null);
                setProfileError(null);
              }}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              <span>{isSw ? 'Kata' : 'Ward'}</span>
            </span>
            <input
              type="text"
              value={form.ward}
              onChange={(e) => {
                setForm((p) => ({ ...p, ward: e.target.value }));
                setProfileNotice(null);
                setProfileError(null);
              }}
              placeholder={isSw ? 'Weka kata yako...' : 'Enter ward...'}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Wilaya' : 'District'}
            </span>
            <input
              type="text"
              value={form.district ?? ''}
              onChange={(e) => {
                setForm((p) => ({ ...p, district: e.target.value }));
                setProfileNotice(null);
                setProfileError(null);
              }}
              placeholder={isSw ? 'Weka wilaya...' : 'Enter district...'}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Anwani ya Mtaa' : 'Street Address'}
            </span>
            <input
              type="text"
              value={form.streetAddress}
              onChange={(e) => {
                setForm((p) => ({ ...p, streetAddress: e.target.value }));
                setProfileNotice(null);
                setProfileError(null);
              }}
              placeholder={isSw ? 'Weka anwani ya mtaa...' : 'Enter street address...'}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Lugha Unayopendelea' : 'Preferred Locale'}
            </span>
            <select
              value={form.preferredLocale ?? locale}
              onChange={(e) => {
                setForm((p) => ({ ...p, preferredLocale: e.target.value as Locale }));
                setProfileNotice(null);
                setProfileError(null);
              }}
              className="w-full min-h-[44px] px-3 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            >
              <option value="sw">{isSw ? 'Kiswahili' : 'Swahili'}</option>
              <option value="en">{isSw ? 'Kiingereza' : 'English'}</option>
            </select>
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
                setProfileNotice(null);
                setProfileError(null);
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
              {isSw
                ? 'Picha ya Mfanyabiashara (SokoKuu / ImageKit)'
                : 'Merchant Image (SokoKuu / ImageKit)'}
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
                label={isSw ? 'Picha ya Mfanyabiashara' : 'Merchant image'}
              />
              <div className="flex-1 min-w-[200px] space-y-2">
                <p className="text-[11px] text-slate-600">
                  {isSw
                    ? 'Pakia picha ya Mfanyabiashara wako. Picha inaonyeshwa kwenye orodha ya Wafanyabiashara sokoni.'
                    : 'Upload your merchant image. It appears on marketplace merchant cards and hubs.'}
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
                  <span>{isSw ? 'Hifadhi Picha ya Mfanyabiashara' : 'Save Merchant Image'}</span>
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
              disabled={savingProfile}
              className="min-h-[44px] px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {savingProfile ? (
                <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{isSw ? 'Hifadhi Wasifu' : 'Save Profile'}</span>
            </button>
          </div>
        </div>
      </form>

      <form
        onSubmit={handleChangePassword}
        className="bg-white border border-slate-200 rounded-lg p-6 space-y-4"
      >
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-slate-900">
            {isSw ? 'Badilisha Nywila' : 'Change Password'}
          </h2>
          <p className="text-xs text-slate-500">
            {isSw
              ? 'Baada ya kubadilisha nywila utaombwa kuingia tena.'
              : 'After changing your password you will be asked to sign in again.'}
          </p>
        </div>

        {passwordNotice && (
          <div
            role="status"
            className="border border-emerald-200 bg-emerald-50 rounded-lg p-3 text-xs font-semibold text-emerald-900"
          >
            {passwordNotice}
          </div>
        )}
        {passwordError && (
          <div
            role="alert"
            className="border border-red-200 bg-red-50 rounded-lg p-3 text-xs font-semibold text-red-900"
          >
            {passwordError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Nywila ya Sasa' : 'Current Password'}
            </span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setPasswordError(null);
                setPasswordNotice(null);
              }}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Nywila Mpya' : 'New Password'}
            </span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPasswordError(null);
                setPasswordNotice(null);
              }}
              minLength={8}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Thibitisha Nywila Mpya' : 'Confirm New Password'}
            </span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setPasswordError(null);
                setPasswordNotice(null);
              }}
              minLength={8}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
              required
            />
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={changingPassword}
            className="min-h-[44px] px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {changingPassword ? (
              <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Lock className="w-4 h-4" aria-hidden="true" />
            )}
            <span>{isSw ? 'Badilisha Nywila' : 'Change Password'}</span>
          </button>
        </div>
      </form>

      {canManageMerchantLocation && (
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                <span>{isSw ? 'Mahali Duka Lilipo & Alama za Njia (Store Map Pin & Driver Markers)' : 'Store Map Pin & Driver Route Markers'}</span>
              </h2>
              <p className="text-xs text-slate-600">
                {isSw
                  ? 'Weka pini ya GPS ya duka, maelezo ya eneo, na alama za njia ili madereva wafike kwa urahisi.'
                  : 'Set your store GPS pin, area details, and ordered route markers to help drivers reach you easily.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={locating}
                className="min-h-[40px] px-3 py-2 text-xs font-semibold rounded-md border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {locating ? <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" /> : <LocateFixed className="w-4 h-4" aria-hidden="true" />}
                <span>{isSw ? 'Weka Pini (GPS ya Sasa)' : '1-tap Geolocation Pin'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSaveMerchantLocation()}
                disabled={locationSaving || !merchantLocation}
                className="min-h-[40px] px-4 py-2 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {locationSaving ? <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
                <span>{isSw ? 'Hifadhi Mahali' : 'Save Location'}</span>
              </button>
            </div>
          </div>

          {locationError && (
            <div role="alert" className="border border-red-200 bg-red-50 rounded-lg p-3 text-xs font-semibold text-red-900">{locationError}</div>
          )}
          {locationNotice && (
            <div role="status" className="border border-emerald-200 bg-emerald-50 rounded-lg p-3 text-xs font-semibold text-emerald-900">{locationNotice}</div>
          )}

          {locationLoading ? (
            <div className="text-sm text-slate-600 py-4 inline-flex items-center gap-2"><LoaderCircle className="w-4 h-4 animate-spin" /> {isSw ? 'Inapakia mahali pa duka...' : 'Loading store location...'}</div>
          ) : merchantLocation ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-slate-700">Latitude</span>
                      <input
                        type="number"
                        step="any"
                        value={merchantLocation.latitude}
                        onChange={(e) => setMerchantLocation((p) => (p ? { ...p, latitude: Number(e.target.value) } : p))}
                        className="w-full min-h-[40px] px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-slate-700">Longitude</span>
                      <input
                        type="number"
                        step="any"
                        value={merchantLocation.longitude}
                        onChange={(e) => setMerchantLocation((p) => (p ? { ...p, longitude: Number(e.target.value) } : p))}
                        className="w-full min-h-[40px] px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900"
                      />
                    </label>
                  </div>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-slate-700">{isSw ? 'Jina la Kata / Eneo (Ward Name)' : 'Ward Name'}</span>
                    <input
                      type="text"
                      value={merchantLocation.wardName}
                      onChange={(e) => setMerchantLocation((p) => (p ? { ...p, wardName: e.target.value } : p))}
                      className="w-full min-h-[40px] px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900"
                      placeholder={isSw ? 'Mfano: Kariakoo' : 'e.g. Kariakoo'}
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-slate-700">{isSw ? 'Alama ya Mtaa / Maelekezo (Street Landmark)' : 'Street Landmark'}</span>
                    <input
                      type="text"
                      value={merchantLocation.streetLandmark}
                      onChange={(e) => setMerchantLocation((p) => (p ? { ...p, streetLandmark: e.target.value } : p))}
                      className="w-full min-h-[40px] px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900"
                      placeholder={isSw ? 'Mfano: Karibu na kituo cha daladala' : 'e.g. Near the bus stop'}
                    />
                  </label>
                </div>
                <div className="rounded-lg border border-slate-200 overflow-hidden h-[260px]">
                  {Number.isFinite(merchantLocation.latitude) && Number.isFinite(merchantLocation.longitude) ? (
                    <MapContainer
                      center={[merchantLocation.latitude, merchantLocation.longitude]}
                      zoom={15}
                      style={{ height: '100%', width: '100%' }}
                      scrollWheelZoom={false}
                    >
                      <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      <Marker position={[merchantLocation.latitude, merchantLocation.longitude]} />
                      {(merchantLocation.routeWaypoints || []).map((w, i) =>
                        typeof w.lat === 'number' && typeof w.lng === 'number' ? (
                          <CircleMarker key={`wp-${i}`} center={[w.lat, w.lng]} radius={8} pathOptions={{ color: '#0054A6', fillColor: '#0054A6', fillOpacity: 0.9 }} />
                        ) : null,
                      )}
                    </MapContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-500 bg-slate-50">
                      {isSw ? 'Weka lat/lng au tumia GPS kuonyesha ramani.' : 'Set lat/lng or use GPS to preview the map.'}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Navigation className="w-4 h-4 text-[#0054A6]" aria-hidden="true" />
                    <span>{isSw ? 'Alama za Njia kwa Mpangilio (Route Markers)' : 'Ordered Route Markers'}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={addRouteWaypoint}
                    className="min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-md border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{isSw ? '+ Ongeza Alama ya Njia (Add Route Marker)' : '+ Add Route Marker'}</span>
                  </button>
                </div>
                {(merchantLocation.routeWaypoints || []).length === 0 ? (
                  <p className="text-xs text-slate-500">{isSw ? 'Hakuna alama za njia bado. Ongeza maelekezo ya kufika dukani.' : 'No route markers yet. Add directions to help drivers find your store.'}</p>
                ) : (
                  <div className="space-y-3">
                    {merchantLocation.routeWaypoints.map((wp, idx) => (
                      <div key={idx} className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#0054A6] text-white text-xs font-bold">{idx + 1}</span>
                          <button type="button" onClick={() => removeRouteWaypoint(idx)} className="text-red-700 hover:text-red-900 inline-flex items-center gap-1 text-xs cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{isSw ? 'Ondoa' : 'Remove'}</span>
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label className="block space-y-1">
                            <span className="text-[11px] font-semibold text-slate-700">{isSw ? 'Jina la Alama (Label)' : 'Label'}</span>
                            <input type="text" value={wp.label} onChange={(e) => updateRouteWaypoint(idx, { label: e.target.value })} className="w-full min-h-[36px] px-2.5 text-xs bg-white border border-slate-300 rounded-md" placeholder={isSw ? 'Mfano: Geuka kulia sokoni' : 'e.g. Turn right at the market'} />
                          </label>
                          <label className="block space-y-1">
                            <span className="text-[11px] font-semibold text-slate-700">{isSw ? 'Maelekezo (Hint)' : 'Hint'}</span>
                            <input type="text" value={wp.hint} onChange={(e) => updateRouteWaypoint(idx, { hint: e.target.value })} className="w-full min-h-[36px] px-2.5 text-xs bg-white border border-slate-300 rounded-md" placeholder={isSw ? 'Maelezo mafupi ya njia' : 'Short direction hint'} />
                          </label>
                          <label className="block space-y-1">
                            <span className="text-[11px] font-semibold text-slate-700">Lat ({isSw ? 'hiari' : 'optional'})</span>
                            <input type="number" step="any" value={wp.lat ?? ''} onChange={(e) => updateRouteWaypoint(idx, { lat: e.target.value === '' ? null : Number(e.target.value) })} className="w-full min-h-[36px] px-2.5 text-xs bg-white border border-slate-300 rounded-md" />
                          </label>
                          <label className="block space-y-1">
                            <span className="text-[11px] font-semibold text-slate-700">Lng ({isSw ? 'hiari' : 'optional'})</span>
                            <input type="number" step="any" value={wp.lng ?? ''} onChange={(e) => updateRouteWaypoint(idx, { lng: e.target.value === '' ? null : Number(e.target.value) })} className="w-full min-h-[36px] px-2.5 text-xs bg-white border border-slate-300 rounded-md" />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-600">
              {isSw ? 'Hakuna data ya mahali pa duka bado. Tumia GPS au weka taarifa kisha uhifadhi.' : 'No store location data yet. Use GPS or enter details and save.'}
              <div className="mt-2">
                <button type="button" onClick={() => setMerchantLocation({ latitude: -6.7924, longitude: 39.2083, wardName: '', streetLandmark: '', routeWaypoints: [] })} className="text-emerald-700 font-semibold hover:underline cursor-pointer">
                  {isSw ? 'Anza kuweka mahali pa duka' : 'Start setting store location'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
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
  const { isInstalled: isPwaInstalled } = usePWAInstall();
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
              onClick={() => {
                onSetLocale('sw');
                setSavedFlag(true);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                locale === 'sw' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Kiswahili
            </button>
            <button
              type="button"
              onClick={() => {
                onSetLocale('en');
                setSavedFlag(true);
              }}
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

        {!isPwaInstalled && (
          <div className="p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Smartphone className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {isSw ? 'Sakinisha SokoKuu kwenye Simu' : 'Install SokoKuu on Your Phone'}
                </div>
                <div className="text-xs text-slate-500">
                  {isSw
                    ? 'Weka app kwenye home screen yako ili ifunguke haraka na ifanye kazi hata nje ya mtandao.'
                    : 'Add the app to your home screen for quick access and offline support.'}
                </div>
              </div>
            </div>
            <PWAInstallButton locale={locale} />
          </div>
        )}
      </div>
    </div>
  );
}
