import { useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  Lock,
  LogOut,
  ShieldCheck,
  Store,
  Users,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { SokoApiClient, SokoHttpError, isSokoNetworkError } from '../services/sokoApiClient';
import {
  ROLE_LABELS,
  mapTierToAccountMode,
  normalizeTzPhoneE164,
  type PlatformRole,
  type UserProfile,
} from '../types/auth';
import { BrandLogo } from './BrandLogo';
import { SalesLeadsDashboard } from './SalesLeadsDashboard';
import { SalesStaffManagement } from './SalesStaffManagement';

interface WorkspaceLoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    phoneE164: string;
    fullName: string;
    role: PlatformRole;
    businessId?: string | null;
    tier?: string | null;
    preferredLocale?: string;
    preferredLanguage?: string;
  };
}

const SALES_ROLES: PlatformRole[] = ['SALES_STAFF', 'SUPER_ADMIN'];

function normalizeLocale(value?: string | null): Locale {
  return value === 'en' ? 'en' : 'sw';
}

/**
 * Standalone sales application. Reached from `#/sales-dashboard`; it owns its
 * header, sign-in screen and tabs instead of mounting the merchant shell.
 */
export function SalesWorkspace({
  locale,
  profile,
  onSignIn,
  onExit,
  onLogout,
}: {
  locale: Locale;
  profile: UserProfile | null;
  onSignIn: (profile: UserProfile) => void;
  onExit: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const isSw = locale === 'sw';
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'leads' | 'staff'>('leads');

  const hasToken = SokoApiClient.hasAccessToken();
  const role = profile?.role;
  const isSalesRole = role === 'SALES_STAFF' || role === 'SUPER_ADMIN';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const normalizedPhone = normalizeTzPhoneE164(phone);
    if (!/^\+255[67]\d{8}$/.test(normalizedPhone)) {
      setError(
        isSw
          ? 'Weka namba sahihi ya simu ya Tanzania (+2556XXXXXXXX au +2557XXXXXXXX).'
          : 'Enter a valid Tanzanian mobile number (+2556XXXXXXXX or +2557XXXXXXXX).',
      );
      return;
    }
    if (!password.trim()) {
      setError(isSw ? 'Weka nenosiri lako.' : 'Enter your password.');
      return;
    }

    setBusy(true);
    try {
      const resp = await SokoApiClient.post<WorkspaceLoginResponse>(
        '/auth/login',
        { phoneE164: normalizedPhone, password },
        false,
      );
      const loginRole = resp?.user?.role;
      if (!resp?.accessToken || !resp?.refreshToken || !resp?.user || !loginRole) {
        throw new Error(
          isSw ? 'Majibu ya uthibitisho hayakukamilika.' : 'Incomplete authentication response.',
        );
      }
      if (!SALES_ROLES.includes(loginRole)) {
        SokoApiClient.clearTokens();
        setError(
          isSw
            ? 'Akaunti hii si ya timu ya mauzo. Tafadhali tumia akaunti iliyoundwa na admin kwa ajili ya mauzo.'
            : 'This account is not a sales team account. Use the sales account created by your administrator.',
        );
        return;
      }

      SokoApiClient.setTokens(resp.accessToken, resp.refreshToken);
      let lang = normalizeLocale(
        resp.user.preferredLanguage ?? resp.user.preferredLocale,
      );
      try {
        const me = await SokoApiClient.get<{
          user?: { preferredLanguage?: string; preferredLocale?: string };
        }>('/auth/me');
        lang = normalizeLocale(
          me?.user?.preferredLanguage ?? me?.user?.preferredLocale ?? lang,
        );
      } catch {
        // Keep the language from the login response if /auth/me is unavailable.
      }

      const label = ROLE_LABELS[loginRole]?.[lang] ?? loginRole;
      onSignIn({
        userId: resp.user.id,
        businessId: resp.user.businessId ?? null,
        tier: resp.user.tier ?? null,
        fullName: resp.user.fullName,
        phone: resp.user.phoneE164 || normalizedPhone,
        email: '',
        businessLabel: label,
        ward: '',
        streetAddress: '',
        role: loginRole,
        mode: mapTierToAccountMode(loginRole, resp.user.tier),
        preferredLocale: lang,
        preferredLanguage: lang,
        smsAlertsEnabled: true,
        offlineSmsFallbackEnabled: true,
      });
      setPassword('');
    } catch (err) {
      if (err instanceof SokoHttpError) {
        setError(err.message);
      } else if (isSokoNetworkError(err)) {
        setError(
          isSw
            ? 'Imeshindikana kuunganisha na SokoKuu. Jaribu tena.'
            : 'Cannot reach SokoKuu. Please retry.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Sign in failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await onLogout();
    onExit();
  };

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 flex flex-col sk-safe-x pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200 sk-safe-top">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" />
            <div className="border-l border-slate-200 pl-3">
              <div className="text-sm font-bold text-slate-900">
                {isSw ? 'Dashboard ya Mauzo' : 'Sales Workspace'}
              </div>
              <div className="text-[10px] font-mono text-slate-500">SOKOKUU TZ · SALES</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onExit}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              {isSw ? 'Rudi kwenye app' : 'Back to app'}
            </button>
            {hasToken && isSalesRole && profile && (
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                {isSw ? 'Toka' : 'Sign out'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-5">
        {!hasToken ? (
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
            <div className="space-y-1.5 text-center">
              <div className="mx-auto w-10 h-10 rounded-xl bg-emerald-50 grid place-items-center">
                <Lock className="w-5 h-5 text-emerald-600" aria-hidden="true" />
              </div>
              <h1 className="text-lg font-bold text-slate-900">
                {isSw ? 'Ingia kwenye Mauzo' : 'Sales Team Sign In'}
              </h1>
              <p className="text-xs text-slate-600">
                {isSw
                  ? 'Tumia akaunti ya timu ya mauzo iliyoundwa na admin.'
                  : 'Use the sales team account created by your administrator.'}
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Namba ya Simu (+255)' : 'Phone Number (+255)'}
                </span>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setError(null);
                  }}
                  placeholder="+2557XXXXXXXX"
                  className="w-full min-h-[44px] px-3 rounded-lg border border-slate-300 text-sm font-mono text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Nenosiri' : 'Password'}
                </span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  placeholder="••••••••"
                  className="w-full min-h-[44px] px-3 rounded-lg border border-slate-300 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
              </label>
              {error && (
                <p className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[44px] rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                )}
                {isSw ? 'Ingia' : 'Sign in'}
              </button>
            </form>
          </div>
        ) : !profile ? (
          <div className="py-16 text-center text-sm text-slate-600 inline-flex items-center justify-center gap-2 w-full">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" aria-hidden="true" />
            {isSw ? 'Inapakia akaunti ya mauzo...' : 'Loading sales account...'}
          </div>
        ) : !isSalesRole ? (
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-red-200 shadow-sm p-6 space-y-3 text-center">
            <p className="text-sm font-bold text-red-700">
              {isSw ? 'Huna ruhusa ya Mauzo' : 'Sales access denied'}
            </p>
            <p className="text-xs text-slate-600">
              {isSw
                ? 'Akaunti hii haiko kwenye timu ya mauzo. Toka kisha ingia na akaunti sahihi.'
                : 'This account is not on the sales team. Sign out and use the correct account.'}
            </p>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="w-full min-h-[44px] rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              {isSw ? 'Toka' : 'Sign out'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div>
                <div className="text-xs font-bold text-slate-900">{profile.fullName}</div>
                <div className="text-[11px] text-slate-500">
                  {profile.phone} · {profile.businessLabel}
                </div>
              </div>
              <nav className="flex flex-wrap items-center gap-2" aria-label="Sales workspace tabs">
                <button
                  type="button"
                  onClick={() => setTab('leads')}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                    tab === 'leads'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Store className="w-3.5 h-3.5" aria-hidden="true" />
                  {isSw ? 'Wateja & Nukuu' : 'Leads & Quotes'}
                </button>
                {role === 'SUPER_ADMIN' && (
                  <button
                    type="button"
                    onClick={() => setTab('staff')}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                      tab === 'staff'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" aria-hidden="true" />
                    {isSw ? 'Staff wa Mauzo' : 'Sales Staff'}
                  </button>
                )}
              </nav>
            </div>

            {tab === 'leads' ? (
              <SalesLeadsDashboard locale={locale} />
            ) : (
              <SalesStaffManagement locale={locale} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
