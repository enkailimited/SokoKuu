import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Crosshair,
  KeyRound,
  Languages,
  Lock,
  MapPin,
  Phone,
  ShieldCheck,
  Store,
  UserPlus,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  ROLE_LABELS,
  mapTierToAccountMode,
  normalizeTzPhoneE164,
  type PlatformRole,
  type UserProfile,
} from '../types/auth';
import { BrandLogo } from './BrandLogo';
import { BackendOfflineBanner } from './DatabaseStateBanner';
import { OfflineIndicator } from './OfflineIndicator';
import { PWAInstallButton } from './PWAInstallButton';
import {
  SokoApiClient,
  SokoHttpError,
  checkBackendHealth,
  isSokoNetworkError,
} from '../services/sokoApiClient';

type ResetView = 'AUTH' | 'RESET_CHALLENGE' | 'RESET_CONFIRM';
type PublicBusinessTier = 'RETAIL_DUKA' | 'WHOLESALE';

interface PublicLeadCoordinates {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  source: 'device' | 'estimate';
}

interface PublicLeadResponse {
  leadId: string;
  merchantName: string;
  status?: string;
  message?: string;
}

// Dar es Salaam city centre. Used only when the browser cannot supply GPS;
// the note attached to the lead tells the team to confirm the applicant's ward.
const ESTIMATED_LEAD_COORDINATES: PublicLeadCoordinates = {
  latitude: -6.7924,
  longitude: 39.2083,
  accuracyMeters: 5000,
  source: 'estimate',
};

const isValidTanzaniaCoordinate = (latitude: number, longitude: number): boolean =>
  latitude >= -11.75 && latitude <= -0.95 && longitude >= 29.3 && longitude <= 40.5;

interface AuthTokenResponsePayload {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    phoneE164: string;
    fullName: string;
    role: PlatformRole;
    businessId: string | null;
    tier: string | null;
    preferredLocale: string;
    preferredLanguage?: string;
  };
}

interface PasswordResetChallengeResponse {
  devCode?: string;
  code?: string;
  otp?: string;
  message?: string;
}

export function AuthPortalView({
  locale,
  onToggleLocale,
  onSignIn,
}: {
  locale: Locale;
  onToggleLocale: () => void;
  onSignIn: (profile: UserProfile) => void;
}) {
  const isSw = locale === 'sw';
  const [authTab, setAuthTab] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [resetView, setResetView] = useState<ResetView>('AUTH');
  const [phoneInput, setPhoneInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [fullNameInput, setFullNameInput] = useState<string>('');

  // Public quote / registration lead capture
  const [businessNameInput, setBusinessNameInput] = useState<string>('');
  const [wardInput, setWardInput] = useState<string>('');
  const [quoteInput, setQuoteInput] = useState<string>('');
  const [businessTier, setBusinessTier] = useState<PublicBusinessTier>('RETAIL_DUKA');
  const [leadGps, setLeadGps] = useState<PublicLeadCoordinates | null>(null);
  const [locatingGps, setLocatingGps] = useState(false);
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);
  const [submittedLead, setSubmittedLead] = useState<{
    reference: string;
    merchantName: string;
    duplicate?: boolean;
  } | null>(null);

  const [resetPhone, setResetPhone] = useState<string>('');
  const [resetCode, setResetCode] = useState<string>('');
  const [resetNewPassword, setResetNewPassword] = useState<string>('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState<string>('');
  const [resetDevCode, setResetDevCode] = useState<string | null>(null);
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [checkingHealth, setCheckingHealth] = useState<boolean>(false);

  const pollHealth = async () => {
    setCheckingHealth(true);
    const res = await checkBackendHealth();
    setBackendOnline(res.online);
    setCheckingHealth(false);
  };

  useEffect(() => {
    let active = true;
    const check = async () => {
      const res = await checkBackendHealth();
      if (active) setBackendOnline(res.online);
    };
    void check();
    const timer = window.setInterval(check, 15000);
    const onNetChange = () => void check();
    window.addEventListener('online', onNetChange);
    window.addEventListener('offline', onNetChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('online', onNetChange);
      window.removeEventListener('offline', onNetChange);
    };
  }, []);

  const hydrateAndEnter = async (resp: AuthTokenResponsePayload, fallbackPhone: string) => {
    SokoApiClient.setTokens(resp.accessToken, resp.refreshToken);
    setBackendOnline(true);

    const role = resp.user.role;
    let profile: UserProfile = {
      userId: resp.user.id,
      businessId: resp.user.businessId ?? null,
      tier: resp.user.tier ?? null,
      fullName: resp.user.fullName,
      phone: resp.user.phoneE164 || fallbackPhone,
      email: '',
      businessLabel: isSw ? ROLE_LABELS[role].sw : ROLE_LABELS[role].en,
      ward: '',
      streetAddress: '',
      role,
      mode: mapTierToAccountMode(role, resp.user.tier),
      preferredLocale: (resp.user.preferredLanguage ?? resp.user.preferredLocale ?? 'sw') as Locale,
      preferredLanguage: (resp.user.preferredLanguage ?? resp.user.preferredLocale ?? 'sw') as Locale,
      smsAlertsEnabled: true,
      offlineSmsFallbackEnabled: true,
    };

    try {
      const me = await SokoApiClient.get<{
        user?: {
          id: string;
          phoneE164: string;
          fullName: string;
          role: PlatformRole;
          preferredLocale?: string;
          preferredLanguage?: string;
        };
        businessProfile?: {
          id: string;
          smsShortCode: string;
          businessName: string;
          tier: string;
          ward: string;
          district: string;
          streetAddress: string;
          geospatialMapEnabled: boolean;
          isPlatformManaged: boolean;
          logoCdnUrl?: string | null;
        } | null;
        tenantContext?: {
          businessId?: string | null;
          tier?: string | null;
        } | null;
      }>('/auth/me');

      if (me?.user) {
        const lang = (me.user.preferredLanguage ?? me.user.preferredLocale ?? profile.preferredLanguage ?? 'sw') as Locale;
        profile = {
          ...profile,
          preferredLocale: lang,
          preferredLanguage: lang,
        };
      }

      if (me?.businessProfile) {
        profile = {
          ...profile,
          businessId: me.businessProfile.id,
          smsShortCode: me.businessProfile.smsShortCode,
          tier: me.businessProfile.tier,
          geospatialMapEnabled: me.businessProfile.geospatialMapEnabled,
          isPlatformManaged: me.businessProfile.isPlatformManaged,
          businessLabel: me.businessProfile.businessName,
          ward: me.businessProfile.ward,
          streetAddress: me.businessProfile.streetAddress,
          shopImageUrl: me.businessProfile.logoCdnUrl ?? profile.shopImageUrl ?? null,
          mode: mapTierToAccountMode(role, me.businessProfile.tier),
        };
      }
    } catch {
      // Proceed with login response claim set if optional profile enrichment fails
    }

    onSignIn(profile);
  };

  const openResetChallenge = () => {
    const seededPhone = normalizeTzPhoneE164(phoneInput);
    setResetPhone(seededPhone || phoneInput);
    setResetCode('');
    setResetNewPassword('');
    setResetConfirmPassword('');
    setResetDevCode(null);
    setResetNotice(null);
    setAuthError(null);
    setResetView('RESET_CHALLENGE');
  };

  const backToLoginFromReset = () => {
    setResetView('AUTH');
    setAuthTab('LOGIN');
    setAuthError(null);
    setResetNotice(null);
    setResetDevCode(null);
    setResetCode('');
    setResetNewPassword('');
    setResetConfirmPassword('');
  };

  const handleResetChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setResetNotice(null);
    setResetDevCode(null);

    const normalizedPhone = normalizeTzPhoneE164(resetPhone);
    if (!/^\+255[67][0-9]{8}$/.test(normalizedPhone)) {
      setAuthError(
        isSw
          ? 'Weka namba sahihi ya simu ya Tanzania (+2556XXXXXXXX au +2557XXXXXXXX).'
          : 'Enter a valid Tanzanian mobile number (+2556XXXXXXXX or +2557XXXXXXXX).'
      );
      return;
    }

    setSubmitting(true);
    try {
      const resp = await SokoApiClient.post<PasswordResetChallengeResponse>(
        '/auth/password-reset/challenge',
        { phoneE164: normalizedPhone },
        false
      );
      const devCode = resp?.devCode ?? resp?.code ?? resp?.otp ?? null;
      setResetPhone(normalizedPhone);
      setResetDevCode(devCode);
      if (devCode) {
        setResetCode(devCode);
      }
      setResetNotice(
        isSw
          ? 'Ombi la urejeshaji wa nywila limetumwa. Weka msimbo wa uthibitisho kuendelea.'
          : 'Password reset challenge sent. Enter the verification code to continue.'
      );
      setResetView('RESET_CONFIRM');
      setBackendOnline(true);
    } catch (err) {
      if (err instanceof SokoHttpError) {
        setBackendOnline(true);
        setAuthError(err.message);
      } else if (isSokoNetworkError(err)) {
        setBackendOnline(false);
        setAuthError(
          isSw
            ? 'Imeshindikana kuunganisha na SokoKuu. Jaribu tena.'
            : 'Cannot reach SokoKuu. Retry.'
        );
      } else {
        setAuthError(err instanceof Error ? err.message : 'Password reset challenge failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setResetNotice(null);

    const normalizedPhone = normalizeTzPhoneE164(resetPhone);
    if (!/^\+255[67][0-9]{8}$/.test(normalizedPhone)) {
      setAuthError(
        isSw
          ? 'Weka namba sahihi ya simu ya Tanzania (+2556XXXXXXXX au +2557XXXXXXXX).'
          : 'Enter a valid Tanzanian mobile number (+2556XXXXXXXX or +2557XXXXXXXX).'
      );
      return;
    }
    if (!resetCode.trim()) {
      setAuthError(
        isSw ? 'Weka msimbo wa uthibitisho.' : 'Enter the verification code.'
      );
      return;
    }
    if (resetNewPassword.length < 8) {
      setAuthError(
        isSw
          ? 'Nywila mpya lazima iwe na herufi zisizopungua 8.'
          : 'New password must be at least 8 characters long.'
      );
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setAuthError(
        isSw ? 'Nywila mpya hazifanani.' : 'New passwords do not match.'
      );
      return;
    }

    setSubmitting(true);
    try {
      await SokoApiClient.post(
        '/auth/password-reset/confirm',
        {
          phoneE164: normalizedPhone,
          verificationCode: resetCode.trim(),
          newPassword: resetNewPassword,
        },
        false
      );
      setBackendOnline(true);
      setPhoneInput(normalizedPhone);
      setPasswordInput('');
      setResetCode('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      setResetDevCode(null);
      setResetNotice(
        isSw
          ? 'Nywila imerejeshwa. Tafadhali ingia kwa nywila mpya.'
          : 'Password reset successful. Please sign in with your new password.'
      );
      setResetView('AUTH');
      setAuthTab('LOGIN');
    } catch (err) {
      if (err instanceof SokoHttpError) {
        setBackendOnline(true);
        setAuthError(err.message);
      } else if (isSokoNetworkError(err)) {
        setBackendOnline(false);
        setAuthError(
          isSw
            ? 'Imeshindikana kuunganisha na SokoKuu. Jaribu tena.'
            : 'Cannot reach SokoKuu. Retry.'
        );
      } else {
        setAuthError(err instanceof Error ? err.message : 'Password reset confirmation failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const readDeviceLocation = () => {
    setGpsNotice(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLeadGps(ESTIMATED_LEAD_COORDINATES);
      setGpsNotice(
        isSw
          ? 'GPS haipatikani kwenye kifaa hiki. Tutatumia makadirio ya Dar es Salaam; timu itathibitisha kata yako.'
          : 'GPS is unavailable on this device. We will use an estimated Dar es Salaam location; our team will confirm your ward.',
      );
      return;
    }

    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (isValidTanzaniaCoordinate(latitude, longitude)) {
          setLeadGps({
            latitude,
            longitude,
            accuracyMeters: Math.min(5000, Math.max(1, Math.round(accuracy || 100))),
            source: 'device',
          });
          setGpsNotice(null);
        } else {
          setLeadGps(ESTIMATED_LEAD_COORDINATES);
          setGpsNotice(
            isSw
              ? 'Eneo la kifaa liko nje ya Tanzania; tutatumia makadirio ya Dar es Salaam.'
              : 'Device location is outside Tanzania; we will use an estimated Dar es Salaam location.',
          );
        }
        setLocatingGps(false);
      },
      () => {
        setLeadGps(ESTIMATED_LEAD_COORDINATES);
        setGpsNotice(
          isSw
            ? 'GPS haikuruhusiwa; tutatumia makadirio ya Dar es Salaam. Timu itathibitisha kata yako.'
            : 'GPS permission was denied; we will use an estimated Dar es Salaam location. Our team will confirm your ward.',
        );
        setLocatingGps(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const normalizedPhone = normalizeTzPhoneE164(phoneInput);
    if (!/^\+255[67][0-9]{8}$/.test(normalizedPhone)) {
      setAuthError(
        isSw
          ? 'Weka namba sahihi ya simu ya Tanzania (+2556XXXXXXXX au +2557XXXXXXXX).'
          : 'Enter a valid Tanzanian mobile number (+2556XXXXXXXX or +2557XXXXXXXX).'
      );
      return;
    }

    if (authTab === 'REGISTER') {
      const cleanOwner = fullNameInput.trim();
      const cleanMerchant = businessNameInput.trim();
      const cleanWard = wardInput.trim();
      if (!cleanOwner || !cleanMerchant || !cleanWard) {
        setAuthError(
          isSw
            ? 'Jaza jina lako, jina la biashara, na kata/mahali pa biashara.'
            : 'Enter your name, business name, and business ward/location.'
        );
        return;
      }

      const coordinates = leadGps ?? ESTIMATED_LEAD_COORDINATES;
      const quoteParts: string[] = [];
      if (quoteInput.trim()) quoteParts.push(quoteInput.trim());
      quoteParts.push(
        coordinates.source === 'device'
          ? isSw
            ? `[GPS ya kifaa: ${coordinates.latitude}, ${coordinates.longitude} ±${coordinates.accuracyMeters}m]`
            : `[Device GPS: ${coordinates.latitude}, ${coordinates.longitude} ±${coordinates.accuracyMeters}m]`
          : isSw
            ? `[Eneo lilikadiriwa: Dar es Salaam. Kata: ${cleanWard}. Tafadhali thibitisha na mwombaji.]`
            : `[Estimated location: Dar es Salaam. Ward: ${cleanWard}. Please verify with applicant.]`,
      );

      setSubmitting(true);
      try {
        const created = await SokoApiClient.post<PublicLeadResponse>(
          '/sales/leads/public',
          {
            merchantName: cleanMerchant,
            ownerName: cleanOwner,
            ownerPhoneE164: normalizedPhone,
            wardName: cleanWard,
            businessTier,
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            gpsAccuracyMeters: coordinates.accuracyMeters,
            quoteRequest: quoteParts.join('\n').slice(0, 1000),
          },
          false
        );
        setBackendOnline(true);
        setSubmittedLead({
          reference: (created?.leadId ?? '').slice(0, 8).toUpperCase() || 'RECEIVED',
          merchantName: created?.merchantName || cleanMerchant,
        });
        setQuoteInput('');
      } catch (err) {
        if (err instanceof SokoHttpError) {
          setBackendOnline(true);
          if (err.status === 409) {
            // Phone already captured as a lead: treat as a completed request so
            // the applicant is not told to re-submit the same details.
            setSubmittedLead({
              reference: 'ALREADY-QUEUED',
              merchantName: cleanMerchant,
              duplicate: true,
            });
          } else {
            setAuthError(err.message);
          }
        } else if (isSokoNetworkError(err)) {
          setBackendOnline(false);
          setAuthError(
            isSw
              ? 'Imeshindikana kuunganisha na SokoKuu. Jaribu tena.'
              : 'Cannot reach SokoKuu. Retry.'
          );
        } else {
          setAuthError(err instanceof Error ? err.message : 'Failed to submit request.');
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!passwordInput.trim()) {
      setAuthError(
        isSw ? 'Tafadhali weka nenosiri lako.' : 'Please enter your account password.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const resp = await SokoApiClient.post<AuthTokenResponsePayload>(
        '/auth/login',
        {
          phoneE164: normalizedPhone,
          password: passwordInput,
        },
        false
      );
      if (!resp?.accessToken || !resp?.user) {
        throw new Error(
          isSw ? 'Majibu ya uthibitisho hayakukamilika.' : 'Incomplete authentication response.'
        );
      }
      await hydrateAndEnter(resp, normalizedPhone);
    } catch (err) {
      if (err instanceof SokoHttpError) {
        setBackendOnline(true);
        setAuthError(err.message);
      } else if (isSokoNetworkError(err)) {
        setBackendOnline(false);
        setAuthError(
          isSw
            ? 'Imeshindikana kuunganisha na SokoKuu. Jaribu tena.'
            : 'Cannot reach SokoKuu. Retry.'
        );
      } else {
        setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-white text-slate-900 flex flex-col sk-safe-x">
      <header className="sticky top-0 z-40 sk-safe-top h-16 px-5 sm:px-8 bg-white/90 backdrop-blur-md border-b border-slate-100 flex items-center justify-between gap-4">
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
        <div className="w-full max-w-lg space-y-5">
          {backendOnline === false && (
            <BackendOfflineBanner
              locale={locale}
              onRetry={() => void pollHealth()}
              retrying={checkingHealth}
            />
          )}

          <div className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 space-y-6">
            <div className="space-y-2 border-b border-slate-100 pb-4">
              <div className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-emerald-600">
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                <span>SokoKuu TZ</span>
              </div>
              <h1 className="text-xl font-bold text-slate-900">
                {resetView === 'RESET_CHALLENGE'
                  ? isSw
                    ? 'Sahau Nywila?'
                    : 'Forgot Password?'
                  : resetView === 'RESET_CONFIRM'
                    ? isSw
                      ? 'Weka Nywila Mpya'
                      : 'Set New Password'
                    : authTab === 'LOGIN'
                      ? isSw
                        ? 'Ingia Kwenye Akaunti Yako'
                        : 'Sign In to SokoKuu'
                      : isSw
                        ? 'Omba Usajili wa Mfanyabiashara'
                        : 'Request Merchant Registration'}
              </h1>
              {resetView === 'AUTH' && authTab === 'REGISTER' && (
                <p className="text-xs leading-relaxed text-slate-600">
                  {isSw
                    ? 'Tuma taarifa zako kama ombi/nukuu. Timu ya SokoKuu itawasiliana nawe kwa simu kukamilisha usajili na uthibitisho wa mfanyabiashara.'
                    : 'Send your details as a quote/registration request. The SokoKuu team will call you to complete your merchant registration and verification.'}
                </p>
              )}
            </div>

            {resetView === 'AUTH' && (
              <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('LOGIN');
                    setAuthError(null);
                    setResetNotice(null);
                    setSubmittedLead(null);
                  }}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    authTab === 'LOGIN'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {isSw ? 'Ingia' : 'Sign In'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('REGISTER');
                    setAuthError(null);
                    setResetNotice(null);
                    setSubmittedLead(null);
                  }}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    authTab === 'REGISTER'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {isSw ? 'Pata Nukuu' : 'Get a Quote'}
                </button>
              </div>
            )}

            {resetNotice && (
              <div className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md p-3">
                {resetNotice}
              </div>
            )}

            {resetView === 'RESET_CHALLENGE' ? (
              <form onSubmit={handleResetChallenge} className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    <span>{isSw ? 'Namba ya Simu (+255)' : 'Phone Number (+255)'}</span>
                  </span>
                  <input
                    type="tel"
                    required
                    value={resetPhone}
                    onChange={(e) => {
                      setResetPhone(e.target.value);
                      setAuthError(null);
                    }}
                    placeholder="+2557XXXXXXXX"
                    className="w-full min-h-[44px] px-3.5 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                </label>

                {authError && (
                  <div className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {submitting
                      ? isSw
                        ? 'Inatuma...'
                        : 'Sending...'
                      : isSw
                        ? 'Tuma Ombi la Urejeshaji'
                        : 'Send Reset Challenge'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={backToLoginFromReset}
                  className="w-full text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  {isSw ? 'Rudi kwenye kuingia' : 'Back to sign in'}
                </button>
              </form>
            ) : resetView === 'RESET_CONFIRM' ? (
              <form onSubmit={handleResetConfirm} className="space-y-4">
                {resetDevCode && (
                  <div className="text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-md p-3">
                    <span className="font-semibold">{isSw ? 'Msimbo wa majaribio (devCode):' : 'Dev code:'}</span>{' '}
                    <span className="font-mono">{resetDevCode}</span>
                  </div>
                )}

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    <span>{isSw ? 'Namba ya Simu (+255)' : 'Phone Number (+255)'}</span>
                  </span>
                  <input
                    type="tel"
                    value={resetPhone}
                    readOnly
                    className="w-full min-h-[44px] px-3.5 text-sm font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-700"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Msimbo wa Uthibitisho' : 'Verification Code'}
                  </span>
                  <input
                    type="text"
                    required
                    value={resetCode}
                    onChange={(e) => {
                      setResetCode(e.target.value);
                      setAuthError(null);
                    }}
                    className="w-full min-h-[44px] px-3.5 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    <span>{isSw ? 'Nywila Mpya' : 'New Password'}</span>
                  </span>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={resetNewPassword}
                    onChange={(e) => {
                      setResetNewPassword(e.target.value);
                      setAuthError(null);
                    }}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] px-3.5 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    <span>{isSw ? 'Thibitisha Nywila Mpya' : 'Confirm New Password'}</span>
                  </span>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={resetConfirmPassword}
                    onChange={(e) => {
                      setResetConfirmPassword(e.target.value);
                      setAuthError(null);
                    }}
                    placeholder="••••••••"
                    className="w-full min-h-[44px] px-3.5 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                </label>

                {authError && (
                  <div className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {submitting
                      ? isSw
                        ? 'Inathibitisha...'
                        : 'Processing...'
                      : isSw
                        ? 'Weka Nywila Mpya'
                        : 'Reset Password'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={backToLoginFromReset}
                  className="w-full text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  {isSw ? 'Rudi kwenye kuingia' : 'Back to sign in'}
                </button>
              </form>
            ) : submittedLead ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-800">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />
                    <span className="text-sm font-bold">
                      {isSw ? 'Ombi lako limepokelewa' : 'Your request has been received'}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-emerald-900">
                    {submittedLead.duplicate
                      ? isSw
                        ? `Namba hii tayari ipo kwenye orodha yetu ya wateja. Timu ya SokoKuu itawasiliana nawe kukamilisha usajili wa ${submittedLead.merchantName}.`
                        : `This phone number is already in our lead list. The SokoKuu team will contact you to complete registration for ${submittedLead.merchantName}.`
                      : isSw
                        ? `Asante ${submittedLead.merchantName}. Ombi lako limesajiliwa (REF: ${submittedLead.reference}). Timu yetu itakupigia simu kuthibitisha taarifa, kukamilisha usajili, na kukuwezesha kama mfanyabiashara aliye thibitishwa.`
                        : `Thank you, ${submittedLead.merchantName}. Your request is recorded (REF: ${submittedLead.reference}). Our team will call you to verify your details, complete registration, and activate your verified merchant account.`}
                  </p>
                  <div className="inline-flex items-center gap-1.5 rounded-md bg-white border border-emerald-200 px-2.5 py-1.5 text-[11px] font-mono font-semibold text-emerald-800">
                    <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    {isSw ? 'Usajili wote unathibitishwa na timu' : 'Every merchant is team-verified'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSubmittedLead(null);
                    setAuthTab('LOGIN');
                    setAuthError(null);
                  }}
                  className="w-full min-h-[44px] px-4 text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-md hover:bg-emerald-50 cursor-pointer"
                >
                  {isSw ? 'Ingia kwenye akaunti yako' : 'Sign in to your account'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {authTab === 'REGISTER' && (
                  <>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-slate-700">
                        {isSw ? 'Jina la Mmiliki (Kamili)' : 'Owner Full Name'}
                      </span>
                      <input
                        type="text"
                        required
                        value={fullNameInput}
                        onChange={(e) => {
                          setFullNameInput(e.target.value);
                          setAuthError(null);
                        }}
                        placeholder={isSw ? 'Mfano: Amina Hassan' : 'e.g. Amina Hassan'}
                        className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                      />
                    </label>

                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                        <Store className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                        {isSw ? 'Jina la Biashara / Duka' : 'Business / Shop Name'}
                      </span>
                      <input
                        type="text"
                        required
                        value={businessNameInput}
                        onChange={(e) => {
                          setBusinessNameInput(e.target.value);
                          setAuthError(null);
                        }}
                        placeholder={isSw ? 'Mfano: Duka la Amina' : 'e.g. Amina General Store'}
                        className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                      />
                    </label>

                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-slate-700">
                        {isSw ? 'Aina ya Biashara' : 'Business Type'}
                      </span>
                      <select
                        value={businessTier}
                        onChange={(e) => setBusinessTier(e.target.value as PublicBusinessTier)}
                        className="w-full min-h-[44px] px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                      >
                        <option value="RETAIL_DUKA">
                          {isSw ? 'Mfanyabiashara wa Rejareja (Duka)' : 'Retailer / Duka'}
                        </option>
                        <option value="WHOLESALE">
                          {isSw ? 'Mfanyabiashara wa Jumla' : 'Wholesaler'}
                        </option>
                      </select>
                    </label>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                          {isSw ? 'Kata / Mahali pa Biashara' : 'Ward / Business Location'}
                        </span>
                        <button
                          type="button"
                          onClick={readDeviceLocation}
                          disabled={locatingGps}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 disabled:opacity-50 cursor-pointer"
                        >
                          <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
                          {locatingGps
                            ? isSw
                              ? 'Inasoma...'
                              : 'Reading...'
                            : isSw
                              ? 'Soma GPS'
                              : 'Use my GPS'}
                        </button>
                      </div>
                      <input
                        type="text"
                        required
                        value={wardInput}
                        onChange={(e) => {
                          setWardInput(e.target.value);
                          setAuthError(null);
                        }}
                        placeholder={isSw ? 'Mf. Kariakoo, Dar es Salaam' : 'e.g. Kariakoo, Dar es Salaam'}
                        className="w-full min-h-[44px] px-3.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                      />
                      {leadGps && (
                        <p className="text-[11px] font-mono text-emerald-700">
                          {leadGps.source === 'device'
                            ? `GPS: ${leadGps.latitude.toFixed(4)}, ${leadGps.longitude.toFixed(4)} ±${leadGps.accuracyMeters}m`
                            : isSw
                              ? 'Eneo litakadiriwa; timu itathibitisha kata yako.'
                              : 'Estimated location; our team will confirm your ward.'}
                        </p>
                      )}
                      {gpsNotice && <p className="text-[11px] text-amber-700">{gpsNotice}</p>}
                    </div>

                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-slate-700">
                        {isSw ? 'Unachohitaji / Nukuu (Hiari)' : 'What do you need? / Quote (Optional)'}
                      </span>
                      <textarea
                        rows={3}
                        maxLength={800}
                        value={quoteInput}
                        onChange={(e) => setQuoteInput(e.target.value)}
                        placeholder={isSw
                          ? 'Mfano: Nahitaji bei za jumla za sukari, unga na mafuta ya kupikia...'
                          : 'e.g. I need wholesale prices for sugar, flour and cooking oil...'}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none resize-y"
                      />
                    </label>
                  </>
                )}

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    <span>{isSw ? 'Namba ya Simu (+255)' : 'Phone Number (+255)'}</span>
                  </span>
                  <input
                    type="tel"
                    required
                    value={phoneInput}
                    onChange={(e) => {
                      setPhoneInput(e.target.value);
                      setAuthError(null);
                    }}
                    placeholder="+2557XXXXXXXX"
                    className="w-full min-h-[44px] px-3.5 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                  />
                </label>

                {authTab === 'LOGIN' && (
                  <>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                        <span>{isSw ? 'Nenosiri la Akaunti' : 'Account Password'}</span>
                      </span>
                      <input
                        type="password"
                        required
                        value={passwordInput}
                        onChange={(e) => {
                          setPasswordInput(e.target.value);
                          setAuthError(null);
                        }}
                        placeholder="••••••••"
                        className="w-full min-h-[44px] px-3.5 text-sm font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none"
                      />
                    </label>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={openResetChallenge}
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                      >
                        {isSw ? 'Sahau nywila?' : 'Forgot password?'}
                      </button>
                    </div>
                  </>
                )}

                {authTab === 'REGISTER' && (
                  <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                    {isSw
                      ? 'Hii ni ombi, sio akaunti bado. Timu yetu itawasiliana nawe kukamilisha usajili na uthibitisho.'
                      : 'This is a request, not an account yet. Our team will contact you to complete registration and verification.'}
                  </p>
                )}

                {authError && (
                  <div className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {authTab === 'LOGIN' ? (
                    <Lock className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <UserPlus className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>
                    {submitting
                      ? isSw
                        ? 'Inatuma...'
                        : 'Submitting...'
                      : authTab === 'LOGIN'
                        ? isSw
                          ? 'Ingia'
                          : 'Sign In'
                        : isSw
                          ? 'Tuma Ombi la Nukuu'
                          : 'Submit Quote Request'}
                  </span>
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
