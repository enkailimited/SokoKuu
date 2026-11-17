import { useState } from 'react';
import {
  ArrowRight,
  KeyRound,
  Languages,
  Lock,
  Phone,
  ShieldAlert,
  ShoppingBag,
  Store,
  Truck,
  User,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  MODE_LABELS,
  ROLE_LABELS,
  type PlatformRole,
  type UserProfile,
} from '../types/auth';
import { BrandLogo } from './BrandLogo';
import { OfflineIndicator } from './OfflineIndicator';
import { PWAInstallButton } from './PWAInstallButton';
import { SokoApiClient } from '../services/sokoApiClient';

const ACCOUNT_ORDER: PlatformRole[] = [
  'CONSUMER',
  'RETAILER',
  'WHOLESALER',
  'DRIVER',
  'SUPER_ADMIN',
];

const ROLE_ICONS: Record<PlatformRole, typeof User> = {
  CONSUMER: User,
  RETAILER: ShoppingBag,
  WHOLESALER: Store,
  DRIVER: Truck,
  SUPER_ADMIN: ShieldAlert,
};

export function AuthPortalView({
  locale,
  onToggleLocale,
  accounts,
  onSignIn,
}: {
  locale: Locale;
  onToggleLocale: () => void;
  accounts: Record<PlatformRole, UserProfile>;
  onSignIn: (role: PlatformRole) => void;
}) {
  const isSw = locale === 'sw';
  const [selectedRole, setSelectedRole] = useState<PlatformRole>('CONSUMER');
  const [identifier, setIdentifier] = useState<string>(accounts.CONSUMER.phone);
  const [pinInput, setPinInput] = useState<string>('1234');
  const [authError, setAuthError] = useState<string | null>(null);

  const handleSelectAccount = (role: PlatformRole) => {
    setSelectedRole(role);
    setIdentifier(accounts[role].phone);
    setPinInput(accounts[role].pinCode);
    setAuthError(null);
  };

  const executeLoginAndEnter = async (role: PlatformRole, phoneVal: string, pinVal: string) => {
    try {
      const resp = await SokoApiClient.post<{
        accessToken: string;
        refreshToken: string;
      }>('/auth/login', {
        phoneE164: phoneVal,
        password: pinVal,
      });
      if (resp?.accessToken) {
        SokoApiClient.setTokens(resp.accessToken, resp.refreshToken);
      }
    } catch {
      // Offline fallback: continue cleanly with local role profile
    }
    onSignIn(role);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = identifier.trim().toLowerCase();

    const matchedRole = ACCOUNT_ORDER.find((r) => {
      const acc = accounts[r];
      return (
        acc.phone.toLowerCase() === cleaned ||
        acc.email.toLowerCase() === cleaned ||
        r === selectedRole
      );
    });

    if (!matchedRole) {
      setAuthError(
        isSw
          ? 'Akaunti haijapatikana. Chagua akaunti yako hapa chini au weka namba sahihi.'
          : 'Account not found. Select your account below or enter a valid phone/email.'
      );
      return;
    }

    if (pinInput.trim() !== accounts[matchedRole].pinCode) {
      setAuthError(
        isSw
          ? `PIN si sahihi. Tumia PIN ya jaribio (${accounts[matchedRole].pinCode}).`
          : `Incorrect PIN. Use account PIN (${accounts[matchedRole].pinCode}).`
      );
      return;
    }

    await executeLoginAndEnter(matchedRole, identifier, pinInput);
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      {/* Single Platform Header */}
      <header className="h-16 px-6 bg-white border-b border-slate-100 flex items-center justify-between gap-6">
        <BrandLogo size="md" />
        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton locale={locale} />
          <button
            type="button"
            onClick={onToggleLocale}
            className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 whitespace-nowrap cursor-pointer"
          >
            <Languages className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>{isSw ? 'English' : 'Kiswahili'}</span>
          </button>
        </div>
      </header>
      <OfflineIndicator locale={locale} />

      <main className="flex-1 flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Direct Account Access Cards */}
          <div className="lg:col-span-7 space-y-4">
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-slate-500">
                {isSw
                  ? 'Chagua Akaunti ya Kuingia (Kulingana na Role & Mode):'
                  : 'Select Account to Sign In (Locked to Role & Mode):'}
              </div>

              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white overflow-hidden">
                {ACCOUNT_ORDER.map((role) => {
                  const profile = accounts[role];
                  const Icon = ROLE_ICONS[role];
                  const isSelected = selectedRole === role;

                  return (
                    <div
                      key={role}
                      className={`p-4 flex flex-wrap items-center justify-between gap-4 transition-colors ${
                        isSelected ? 'bg-emerald-50/50' : 'bg-white hover:bg-slate-50/70'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectAccount(role)}
                        className="flex items-start gap-3 text-left min-w-0 flex-1 cursor-pointer"
                      >
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 border ${
                            isSelected
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                        >
                          <Icon className="w-4 h-4" aria-hidden="true" />
                        </div>

                        <div className="min-w-0 space-y-0.5">
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {profile.fullName} · {profile.businessLabel}
                          </div>
                          <div className="text-xs text-slate-600">
                            {isSw ? ROLE_LABELS[role].sw : ROLE_LABELS[role].en} ·{' '}
                            {isSw ? MODE_LABELS[profile.mode].sw : MODE_LABELS[profile.mode].en}
                          </div>
                          <div className="text-xs font-mono tabular-nums text-slate-500">
                            {profile.phone} · {profile.email}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => executeLoginAndEnter(role, profile.phone, profile.pinCode)}
                        className="min-h-[40px] px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <span>{isSw ? 'Ingia' : 'Enter Dashboard'}</span>
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Credential Sign-In Form */}
          <form
            onSubmit={handleFormSubmit}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-5"
          >
            <div className="space-y-1 border-b border-slate-100 pb-4">
              <div className="text-xs font-mono font-semibold text-emerald-600">
                {isSw
                  ? ROLE_LABELS[selectedRole].sw
                  : ROLE_LABELS[selectedRole].en}
              </div>
              <h2 className="text-lg font-bold text-slate-900">
                {isSw ? 'Uthibitisho wa Akaunti' : 'Account Sign-In'}
              </h2>
              <p className="text-xs text-slate-500">
                {isSw
                  ? 'Ingiza namba ya simu au barua pepe na PIN yako ya tarakimu 4.'
                  : 'Enter your registered phone number or email and 4-digit PIN.'}
              </p>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                <span>{isSw ? 'Namba ya Simu au Barua Pepe' : 'Phone Number or Email'}</span>
              </span>
              <input
                type="text"
                required
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  setAuthError(null);
                }}
                className="w-full min-h-[44px] px-3.5 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                <span>{isSw ? 'PIN ya Siri (Jaribio: 1234)' : 'Account PIN (Demo: 1234)'}</span>
              </span>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                required
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  setAuthError(null);
                }}
                className="w-full min-h-[44px] px-3.5 text-base font-mono tracking-widest bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
              />
            </label>

            {authError && (
              <div className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
                {authError}
              </div>
            )}

            <button
              type="submit"
              className="w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Lock className="w-4 h-4" aria-hidden="true" />
              <span>
                {isSw ? 'Ingia Kwenye Dashibodi Yangu' : 'Sign In to My Dashboard'}
              </span>
            </button>

            <div className="pt-2 border-t border-slate-100 text-xs text-slate-500">
              {isSw
                ? 'Ukiingia ndani, utaona skrini zako pekee. Kutumia akaunti nyingine, bonyeza Ondoka (Logout) kwenye wasifu wako juu.'
                : 'Once signed in, only your role workspace is mounted. Use Logout inside your top Profile menu to switch accounts.'}
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
