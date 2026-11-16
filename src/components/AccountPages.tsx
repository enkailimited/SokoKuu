import { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Languages,
  LogOut,
  MapPin,
  Phone,
  Save,
  ShieldCheck,
  SlidersHorizontal,
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

  const allowedModesForRole = (): AccountMode[] => {
    switch (profile.role) {
      case 'WHOLESALER':
        return ['WHOLESALE_HUB', 'HYBRID_STORE'];
      case 'RETAILER':
        return ['RETAIL_DUKA'];
      case 'CONSUMER':
        return ['END_CONSUMER'];
      case 'DRIVER':
        return ['FLEET_RIDER'];
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
            {isSw ? 'Wasifu Wangu & Sasisho la Taarifa' : 'My Profile & Information Update'}
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
              ? 'Taarifa za wasifu wako zimehifadhiwa kikamilifu.'
              : 'Your profile information has been updated and saved.'}
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
              required
              value={form.fullName}
              onChange={(e) => {
                setForm((p) => ({ ...p, fullName: e.target.value }));
                setSavedNotice(false);
              }}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              <span>{isSw ? 'Namba ya Simu (NextSMS)' : 'Phone Number (NextSMS)'}</span>
            </span>
            <input
              type="tel"
              required
              value={form.phone}
              onChange={(e) => {
                setForm((p) => ({ ...p, phone: e.target.value }));
                setSavedNotice(false);
              }}
              className="w-full min-h-[44px] px-3.5 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Barua Pepe' : 'Email Address'}
            </span>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => {
                setForm((p) => ({ ...p, email: e.target.value }));
                setSavedNotice(false);
              }}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Jina la Duka / Biashara / Kitambulisho' : 'Business / Account Label'}
            </span>
            <input
              type="text"
              required
              value={form.businessLabel}
              onChange={(e) => {
                setForm((p) => ({ ...p, businessLabel: e.target.value }));
                setSavedNotice(false);
              }}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              <span>{isSw ? 'Kata / Eneo' : 'Ward / District'}</span>
            </span>
            <input
              type="text"
              required
              value={form.ward}
              onChange={(e) => {
                setForm((p) => ({ ...p, ward: e.target.value }));
                setSavedNotice(false);
              }}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Mtaa & Namba ya Nyumba/Ghala' : 'Street & Landmark'}
            </span>
            <input
              type="text"
              required
              value={form.streetAddress}
              onChange={(e) => {
                setForm((p) => ({ ...p, streetAddress: e.target.value }));
                setSavedNotice(false);
              }}
              className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>
        </div>

        {/* Account Mode (locked to valid options for user's role only) */}
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

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'PIN Mpya ya Akaunti (Tarakimu 4)' : 'Account Access PIN (4 Digits)'}
            </span>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              minLength={4}
              required
              value={form.pinCode}
              onChange={(e) => {
                setForm((p) => ({ ...p, pinCode: e.target.value }));
                setSavedNotice(false);
              }}
              className="w-full min-h-[44px] px-3.5 text-base font-mono tracking-widest bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </label>
        </div>

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
              {isSw ? 'Funga' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="min-h-[44px] px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md inline-flex items-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              <span>{isSw ? 'Hifadhi Mabadiliko' : 'Save Profile Changes'}</span>
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
        {/* Language Setting */}
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

        {/* Low-Data Bundle Saver */}
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

        {/* NextSMS Order Notifications */}
        <div className="p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <SlidersHorizontal className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {isSw ? 'Arifa za NextSMS (Oda & PIN)' : 'NextSMS Dispatch & PIN Alerts'}
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

        {/* Offline SMS Fallback */}
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
      </div>
    </div>
  );
}
