import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { normalizeTzPhoneE164 } from '../types/auth';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

interface SalesStaffRecord {
  userId: string;
  fullName: string;
  phoneE164: string;
  isActive: boolean;
  createdAt: string;
}

interface SalesStaffListResponse {
  count: number;
  staff: SalesStaffRecord[];
}

/**
 * Super-admin-only staff registry. Created accounts use the SALES_STAFF role
 * and sign in through the standalone sales workspace.
 */
export function SalesStaffManagement({ locale }: { locale: Locale }) {
  const isSw = locale === 'sw';
  const [staff, setStaff] = useState<SalesStaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    try {
      const res = await SokoApiClient.get<SalesStaffListResponse>('/admin/staff');
      setStaff(res.staff ?? []);
      setOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setOffline(true);
        setStaff([]);
      } else {
        setNotice({
          kind: 'err',
          text:
            err instanceof SokoHttpError
              ? `HTTP ${err.status}: ${err.message}`
              : 'Failed to load sales staff.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const normalizedPhone = normalizeTzPhoneE164(phone);
    if (!/^\+255[67]\d{8}$/.test(normalizedPhone)) {
      setNotice({
        kind: 'err',
        text: isSw
          ? 'Weka namba sahihi ya simu ya Tanzania (+2556XXXXXXXX au +2557XXXXXXXX).'
          : 'Enter a valid Tanzanian mobile number (+2556XXXXXXXX or +2557XXXXXXXX).',
      });
      return;
    }
    if (password.length < 8) {
      setNotice({
        kind: 'err',
        text: isSw
          ? 'Nenosiri la staff lazima liwe na herufi 8 au zaidi.'
          : 'Staff password must be at least 8 characters long.',
      });
      return;
    }

    setSaving(true);
    try {
      const created = await SokoApiClient.post<{ fullName: string }>('/admin/staff', {
        fullName: fullName.trim(),
        phoneE164: normalizedPhone,
        password,
      });
      setFullName('');
      setPhone('');
      setPassword('');
      setOffline(false);
      await loadStaff();
      setNotice({
        kind: 'ok',
        text: isSw
          ? `Akaunti ya mauzo ya ${created.fullName} imeundwa. Wape namba na nenosiri ili waingie kwenye dashboard ya mauzo.`
          : `Sales account for ${created.fullName} was created. Share the phone and password so they can sign in to the sales dashboard.`,
      });
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setOffline(true);
      } else {
        setNotice({
          kind: 'err',
          text:
            err instanceof SokoHttpError
              ? `HTTP ${err.status}: ${err.message}`
              : 'Failed to create sales staff account.',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (member: SalesStaffRecord) => {
    setNotice(null);
    setTogglingId(member.userId);
    try {
      await SokoApiClient.patch(`/admin/staff/${member.userId}/status`, {
        isActive: !member.isActive,
      });
      setOffline(false);
      await loadStaff();
      setNotice({
        kind: 'ok',
        text: isSw
          ? `Mfanyikazi ${member.fullName} ${member.isActive ? 'amezuiwa' : 'amerudishwa'}.`
          : `Sales staff ${member.fullName} was ${member.isActive ? 'deactivated' : 'reactivated'}.`,
      });
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setOffline(true);
      } else {
        setNotice({
          kind: 'err',
          text:
            err instanceof SokoHttpError
              ? `HTTP ${err.status}: ${err.message}`
              : 'Failed to update sales staff status.',
        });
      }
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {offline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void loadStaff()}
          retrying={loading}
        />
      )}

      {notice && (
        <div
          role="status"
          className={`rounded-lg border px-3 py-2.5 text-xs font-semibold flex items-start gap-2 ${
            notice.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {notice.kind === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : null}
          <span>{notice.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <section className="xl:col-span-5 bg-white border border-slate-100 rounded-lg shadow-sm p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            {isSw ? 'Ongeza Mfanyikazi wa Mauzo' : 'Add Sales Team Member'}
          </h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">
                {isSw ? 'Jina Kamili' : 'Full Name'}
              </span>
              <input
                type="text"
                required
                maxLength={150}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">
                {isSw ? 'Namba ya Simu (+255)' : 'Phone Number (+255)'}
              </span>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+2557XXXXXXXX"
                className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700">
                {isSw ? 'Nenosiri la Kuingia' : 'Login Password'}
              </span>
              <input
                type="password"
                required
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="w-full min-h-[40px] rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {isSw ? 'Unda Akaunti ya Mauzo' : 'Create Sales Account'}
            </button>
          </form>
        </section>

        <section className="xl:col-span-7 bg-white border border-slate-100 rounded-lg shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900">
              {isSw ? 'Timu ya Mauzo' : 'Sales Team'}
            </h3>
            <button
              type="button"
              onClick={() => void loadStaff()}
              disabled={loading}
              className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {staff.length}
            </button>
          </div>

          {loading && staff.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              {isSw ? 'Inapakia timu ya mauzo...' : 'Loading sales team...'}
            </div>
          ) : staff.length === 0 ? (
            <EmptyStateCard
              locale={locale}
              titleSw="Hakuna staff wa mauzo bado"
              titleEn="No sales staff yet"
              descriptionSw="Unda akaunti ya kwanza ya timu ya mauzo upande wa kushoto."
              descriptionEn="Create the first sales team account on the left."
            />
          ) : (
            <div className="space-y-2">
              {staff.map((member) => (
                <div
                  key={member.userId}
                  className="border border-slate-200 rounded-lg px-3 py-2.5 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-xs font-bold text-slate-900">{member.fullName}</div>
                    <a
                      href={`tel:${member.phoneE164}`}
                      className="text-[11px] font-mono text-emerald-700 underline decoration-emerald-300"
                    >
                      {member.phoneE164}
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-1 rounded-md text-[10px] font-bold border ${
                        member.isActive
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-slate-100 border-slate-200 text-slate-600'
                      }`}
                    >
                      {member.isActive
                        ? isSw
                          ? 'Hai'
                          : 'Active'
                        : isSw
                          ? 'Imezuiwa'
                          : 'Inactive'}
                    </span>
                    <button
                      type="button"
                      disabled={togglingId === member.userId}
                      onClick={() => void handleToggleActive(member)}
                      className="px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
                    >
                      {togglingId === member.userId
                        ? isSw
                          ? 'Inasasisha...'
                          : 'Updating...'
                        : member.isActive
                          ? isSw
                            ? 'Zuia'
                            : 'Deactivate'
                          : isSw
                            ? 'Rudisha'
                            : 'Reactivate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
