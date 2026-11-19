import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Loader2,
  Lock,
  MapPin,
  Phone,
  RefreshCw,
  ShieldCheck,
  Store,
  UserPlus,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { useHardwareGeolocation } from '../hooks/useHardwareGeolocation';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import { normalizeTzPhoneE164 } from '../types/auth';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

export type LeadLifecycleStatus = 'Prospect' | 'Converted';
export type LeadBusinessTier = 'Retailer' | 'Wholesaler';

export interface SokoLeadRecord {
  leadId: string;
  merchantName: string;
  ownerName: string;
  ownerPhoneE164: string;
  ward: string;
  businessTier: LeadBusinessTier;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  status: LeadLifecycleStatus;
  version: number;
  convertedAtEat?: string;
}

interface BackendLeadDto {
  leadId: string;
  merchantName: string;
  ownerName: string;
  ownerPhoneE164: string;
  wardName: string;
  businessTier: 'WHOLESALE' | 'RETAIL_DUKA' | 'HYBRID_STORE';
  latitude: number;
  longitude: number;
  gpsAccuracyMeters: number;
  status: 'PROSPECT' | 'CONVERTED' | 'ARCHIVED';
  version: number;
  convertedBusinessId?: string | null;
  capturedAtEat: string;
  convertedAtEat?: string | null;
}

export function SalesLeadsDashboard({ locale = 'sw' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const gps = useHardwareGeolocation(locale);

  const [leads, setLeads] = useState<SokoLeadRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);

  const [merchantName, setMerchantName] = useState<string>('');
  const [ownerName, setOwnerName] = useState<string>('');
  const [ownerPhone, setOwnerPhone] = useState<string>('');
  const [wardName, setWardName] = useState<string>('');
  const [manualLat, setManualLat] = useState<string>('');
  const [manualLng, setManualLng] = useState<string>('');
  const [businessTier, setBusinessTier] = useState<LeadBusinessTier>('Retailer');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadLeadsFromApi = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await SokoApiClient.get<{
        count: number;
        leads: BackendLeadDto[];
      }>('/sales/leads');

      const mapped: SokoLeadRecord[] = (res.leads || []).map((l) => ({
        leadId: l.leadId,
        merchantName: l.merchantName,
        ownerName: l.ownerName,
        ownerPhoneE164: l.ownerPhoneE164,
        ward: l.wardName,
        businessTier: l.businessTier === 'WHOLESALE' ? 'Wholesaler' : 'Retailer',
        latitude: l.latitude,
        longitude: l.longitude,
        accuracyMeters: l.gpsAccuracyMeters,
        status: l.status === 'CONVERTED' ? 'Converted' : 'Prospect',
        version: l.version,
        convertedAtEat: l.convertedAtEat
          ? new Date(l.convertedAtEat).toLocaleTimeString()
          : undefined,
      }));
      setLeads(mapped);
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setLeads([]);
      } else {
        setNotice({
          kind: 'err',
          text:
            err instanceof SokoHttpError
              ? `HTTP ${err.status}: ${err.message}`
              : 'Failed to load sales leads from database.',
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeadsFromApi();
  }, [loadLeadsFromApi]);

  const handlePollHardwareGps = async () => {
    const res = await gps.capturePosition();
    if (res) {
      setManualLat(String(res.latitude));
      setManualLng(String(res.longitude));
    }
  };

  const handleLogLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);

    const cleanMerchant = merchantName.trim();
    const cleanOwner = ownerName.trim();
    const cleanWard = wardName.trim();
    const normalizedPhone = normalizeTzPhoneE164(ownerPhone);

    if (!cleanMerchant || !cleanOwner || !cleanWard || !/^\+255[67]\d{8}$/.test(normalizedPhone)) {
      setNotice({
        kind: 'err',
        text: isSw
          ? 'Jaza jina la biashara, mmiliki, kata, na namba sahihi ya Tanzania (+2557XXXXXXXX / +2556XXXXXXXX).'
          : 'Enter merchant name, owner name, ward, and valid Tanzania MSISDN (+2557XXXXXXXX or +2556XXXXXXXX).',
      });
      return;
    }

    const latVal = Number(manualLat);
    const lngVal = Number(manualLng);
    if (!Number.isFinite(latVal) || !Number.isFinite(lngVal) || manualLat.trim() === '' || manualLng.trim() === '') {
      setNotice({
        kind: 'err',
        text: isSw
          ? 'Bofya "Soma GPS" au weka majira sahihi ya Latitudo na Longitudo.'
          : 'Click "Poll GPS" or enter valid Latitude and Longitude coordinates.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const created = await SokoApiClient.post<{
        leadId: string;
        merchantName: string;
        status: string;
        version: number;
      }>('/sales/leads', {
        merchantName: cleanMerchant,
        ownerName: cleanOwner,
        ownerPhoneE164: normalizedPhone,
        wardName: cleanWard,
        businessTier: businessTier === 'Wholesaler' ? 'WHOLESALE' : 'RETAIL_DUKA',
        latitude: latVal,
        longitude: lngVal,
        gpsAccuracyMeters: Math.max(1, Math.round(gps.coordinates?.accuracyMeters ?? 15)),
      });

      setBackendOffline(false);
      setMerchantName('');
      setOwnerName('');
      setOwnerPhone('');
      setWardName('');
      await loadLeadsFromApi();
      setNotice({
        kind: 'ok',
        text: isSw
          ? `Mteja ${created.merchantName} amerekodiwa kwenye PostgreSQL (${latVal}, ${lngVal}).`
          : `Merchant lead ${created.merchantName} persisted to PostgreSQL (${latVal}, ${lngVal}).`,
      });
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setNotice({
          kind: 'err',
          text:
            err instanceof SokoHttpError
              ? `HTTP ${err.status}: ${err.message}`
              : 'Failed to capture prospect lead.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConvertLead = async (leadId: string, expectedVersion: number) => {
    setNotice(null);
    setConvertingId(leadId);
    try {
      const serverResult = await SokoApiClient.post<{
        leadId: string;
        merchantId: string;
        merchantName: string;
        smsShortCode: string;
        status: string;
        newVersion: number;
        nextSmsQueued: boolean;
      }>(`/sales/leads/${leadId}/convert`, { expectedVersion });

      setBackendOffline(false);
      await loadLeadsFromApi();
      window.dispatchEvent(new CustomEvent('sokokuu:merchants-updated'));

      setNotice({
        kind: 'ok',
        text: isSw
          ? `${serverResult.merchantName} amewashwa & kuthibitishwa (${serverResult.smsShortCode} · v${expectedVersion} -> v${serverResult.newVersion}). NextSMS PIN4 imewekwa kwenye Outbox!`
          : `${serverResult.merchantName} converted & verified (${serverResult.smsShortCode} · v${expectedVersion} -> v${serverResult.newVersion}). NextSMS PIN4 queued!`,
      });
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setNotice({
          kind: 'err',
          text:
            err instanceof SokoHttpError
              ? `HTTP ${err.status}: ${err.message}`
              : 'Lead conversion failed.',
        });
        void loadLeadsFromApi();
      }
    } finally {
      setConvertingId(null);
    }
  };

  const handleTestStaleConflict = async (lead: SokoLeadRecord) => {
    setNotice(null);
    const staleVersion = Math.max(1, lead.version - 1);
    try {
      await SokoApiClient.post(`/sales/leads/${lead.leadId}/convert`, {
        expectedVersion: staleVersion,
      });
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else if (err instanceof SokoHttpError) {
        setNotice({
          kind: 'err',
          text: `HTTP ${err.status} (${isSw ? 'Ulinzi wa Toleo' : 'Optimistic Lock'}): ${err.message}`,
        });
      }
    }
  };

  const convertedCount = leads.filter((l) => l.status === 'Converted').length;
  const prospectCount = leads.filter((l) => l.status === 'Prospect').length;

  return (
    <div className="space-y-5">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void loadLeadsFromApi()}
          retrying={isLoading}
        />
      )}

      {/* Compact Telemetry Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-3 bg-white border border-slate-100 rounded-lg shadow-sm divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
        <div className="p-4 space-y-1">
          <div className="text-xs text-slate-500">
            {isSw ? 'Wateja Wapya (Prospects)' : 'Active Prospects'}
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
            {prospectCount}
          </div>
          <div className="text-[11px] font-mono text-slate-500">PostgreSQL · PostGIS</div>
        </div>
        <div className="p-4 space-y-1">
          <div className="text-xs text-slate-500">
            {isSw ? 'Waliowashwa (NextSMS Sent)' : 'Converted Merchants'}
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-600">
            {convertedCount}
          </div>
          <div className="text-[11px] font-mono text-slate-500">PIN4 + SMS &le; 160 Chars</div>
        </div>
        <div className="p-4 space-y-1">
          <div className="text-xs text-slate-500">
            {isSw ? 'Hali ya GPS ya Kifaa' : 'Device GPS Sensor'}
          </div>
          <div className="text-sm font-bold font-mono tabular-nums text-slate-900">
            {gps.coordinates
              ? `${gps.coordinates.latitude}, ${gps.coordinates.longitude}`
              : isSw
                ? 'Tayari kusoma GPS'
                : 'Ready to poll GPS'}
          </div>
          <div className="text-[11px] font-mono text-emerald-700">
            {gps.coordinates
              ? `±${gps.coordinates.accuracyMeters}m · navigator.geolocation`
              : gps.permissionState}
          </div>
        </div>
      </section>

      {notice && (
        <div
          role="status"
          className={`rounded-lg px-4 py-3 border text-xs font-semibold flex items-center justify-between gap-3 ${
            notice.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.kind === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
            )}
            <span>{notice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <section className="xl:col-span-5 bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <span>{isSw ? 'Sajili Mfanyabiashara Mpya (GPS)' : 'Log Street Prospect (GPS)'}</span>
            </h2>
            <button
              type="button"
              onClick={() => void handlePollHardwareGps()}
              disabled={gps.isCapturing}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer"
            >
              {gps.isCapturing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" aria-hidden="true" />
              ) : (
                <Crosshair className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              )}
              <span>{isSw ? 'Soma GPS' : 'Poll GPS'}</span>
            </button>
          </div>

          <form onSubmit={handleLogLeadSubmit} className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Latitudo (GPS)' : 'Latitude'}
                </label>
                <input
                  type="number"
                  step="any"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  placeholder="-6.8195"
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Longitudo (GPS)' : 'Longitude'}
                </label>
                <input
                  type="number"
                  step="any"
                  value={manualLng}
                  onChange={(e) => setManualLng(e.target.value)}
                  placeholder="39.2764"
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                {isSw ? 'Jina la Mfanyabiashara / Biashara' : 'Merchant / Business Name'}
              </label>
              <input
                type="text"
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                placeholder={isSw ? 'Ingiza jina la biashara' : 'Enter merchant name'}
                className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Jina la Mmiliki' : 'Owner Full Name'}
                </label>
                <input
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder={isSw ? 'Jina kamili' : 'Owner name'}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Simu (ID ya Kuingia)' : 'Owner Phone (Login ID)'}
                </label>
                <input
                  type="tel"
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  placeholder="+2557XXXXXXXX"
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Kata / Mkoa' : 'Ward & District'}
                </label>
                <input
                  type="text"
                  value={wardName}
                  onChange={(e) => setWardName(e.target.value)}
                  placeholder={isSw ? 'Mf. Kariakoo, Dar es Salaam' : 'e.g. Kariakoo, Dar es Salaam'}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Aina ya Biashara' : 'Business Tier'}
                </label>
                <select
                  value={businessTier}
                  onChange={(e) => setBusinessTier(e.target.value as LeadBusinessTier)}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900 bg-white"
                >
                  <option value="Retailer">{isSw ? 'Mfanyabiashara wa Rejareja' : 'Retail Merchant'}</option>
                  <option value="Wholesaler">{isSw ? 'Mfanyabiashara wa Jumla' : 'Wholesale Merchant'}</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[40px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{isSw ? 'Hifadhi Mteja na Majira ya GPS' : 'Save Lead with GPS Matrix'}</span>
            </button>
          </form>
        </section>

        <section className="xl:col-span-7 bg-white border border-slate-100 rounded-lg shadow-sm p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Store className="w-4 h-4 text-emerald-600" aria-hidden="true" />
              <span>
                {isSw
                  ? 'Uthibitisho wa Wafanyabiashara & Utumaji wa NextSMS'
                  : 'Merchant Lead Conversion & NextSMS Provisioning'}
              </span>
            </h2>
            <button
              type="button"
              onClick={() => void loadLeadsFromApi()}
              disabled={isLoading}
              className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Optimistic Lock (version)</span>
            </button>
          </div>

          {isLoading && leads.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              {isSw ? 'Inapakia orodha ya wateja wa uwandani...' : 'Loading sales leads from database...'}
            </div>
          ) : leads.length === 0 ? (
            <EmptyStateCard
              locale={locale}
              titleSw="Hakuna wateja waliosajiliwa bado"
              titleEn="No field leads yet"
              descriptionSw="Tumia fomu ya upande wa kushoto kusajili mteja mpya kwenye PostgreSQL."
              descriptionEn="Use the capture form on the left to log a street prospect to PostgreSQL."
            />
          ) : (
            <div className="space-y-3">
              {leads.map((lead) => {
                const isConverted = lead.status === 'Converted';
                return (
                  <div
                    key={lead.leadId}
                    className="border border-slate-200 rounded-lg p-4 space-y-3 bg-white"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-slate-900">
                            {lead.leadId.slice(0, 8)}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="font-bold text-slate-900">{lead.merchantName}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-600">{lead.businessTier}</span>
                        </div>
                        <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Phone className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                            {lead.ownerPhoneE164}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span>{lead.ownerName}</span>
                          <span className="text-slate-400">·</span>
                          <span>{lead.ward}</span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          GPS: {lead.latitude}, {lead.longitude} (±{lead.accuracyMeters}m) · Version v
                          {lead.version}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {isConverted ? (
                          <>
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                              <span>{isSw ? 'Imewashwa' : 'Converted'}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleTestStaleConflict(lead)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 cursor-pointer"
                            >
                              <Lock className="w-3 h-3 text-amber-600" aria-hidden="true" />
                              <span>{isSw ? 'Jaribu Mgongano (409)' : 'Verify Lock (409)'}</span>
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={convertingId === lead.leadId}
                            onClick={() => void handleConvertLead(lead.leadId, lead.version)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${convertingId === lead.leadId ? 'animate-spin' : ''}`}
                              aria-hidden="true"
                            />
                            <span>
                              {isSw ? 'Thibitisha & Tuma NextSMS' : 'Convert & Dispatch SMS'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
