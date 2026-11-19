import { useCallback, useEffect, useState } from 'react';
import { MapPin, RefreshCw, ShieldAlert, Wifi } from 'lucide-react';
import { useDataSaver } from '../context/DataSaverContext';
import { OptimizedProductImage } from './OptimizedProductImage';
import type { Locale } from '../data/i18n';
import { SokoApiClient, isSokoNetworkError } from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import { formatBusinessTierLabel } from '../lib/sokoManagedState';

const DAR_WARDS = [
  { id: 'sinza', name: 'Sinza Kwaremy', lat: -6.7845, lng: 39.2224 },
  { id: 'kinondoni', name: 'Kinondoni Studio', lat: -6.7875, lng: 39.2621 },
  { id: 'kariakoo', name: 'Kariakoo Msimbazi', lat: -6.8235, lng: 39.2764 },
  { id: 'temeke', name: 'Temeke Mwisho', lat: -6.8669, lng: 39.2672 },
];

interface ApiGeoNode {
  merchantId: string;
  smsShortCode: string;
  merchantName: string;
  tier: string;
  ward: string;
  district: string;
  distanceMeters: number;
}

interface ApiCatalogItem {
  id: string;
  canonicalSku: string;
  fixedNameSw: string;
  fixedNameEn: string;
  categoryCode: string;
  imagekitCdnUrl: string;
}

interface ApiFraudAlertsResponse {
  securityAlerts: Array<{
    id: string;
    eventType: string;
    severity: 'INFO' | 'CRITICAL_3_STRIKE';
    actorName: string | null;
    actorPhone: string | null;
    createdAt: string;
  }>;
  disputedLedgers: Array<{
    ledgerId: string;
    orderRef: string;
    driverName: string;
    varianceTzs: number;
    updatedAt: string;
  }>;
}

export function OptimizationLabPanel({ locale }: { locale: Locale }) {
  const isSw = locale === 'sw';
  const { isLowDataModeActive, toggleLowDataMode } = useDataSaver();

  const [wardId, setWardId] = useState('sinza');
  const [maxMeters, setMaxMeters] = useState(12000);
  const [nearbyNodes, setNearbyNodes] = useState<ApiGeoNode[]>([]);
  const [catalogPreview, setCatalogPreview] = useState<ApiCatalogItem[]>([]);
  const [fraudData, setFraudData] = useState<ApiFraudAlertsResponse>({
    securityAlerts: [],
    disputedLedgers: [],
  });
  const [loading, setLoading] = useState(true);
  const [backendOffline, setBackendOffline] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const selectedWard = DAR_WARDS.find((w) => w.id === wardId) ?? DAR_WARDS[0];

  const loadLabData = useCallback(async () => {
    setLoading(true);
    setGeoError(null);
    try {
      const [geoRes, catalogRes, fraudRes] = await Promise.all([
        SokoApiClient.get<{ nodes: ApiGeoNode[] }>(
          `/geospatial/stores-map-matrix?originLat=${selectedWard.lat}&originLng=${selectedWard.lng}&maxDistanceMeters=${maxMeters}`,
        ),
        SokoApiClient.get<ApiCatalogItem[]>('/marketplace/catalog'),
        SokoApiClient.get<ApiFraudAlertsResponse>('/admin/audit/fraud-alerts'),
      ]);

      setNearbyNodes(geoRes.nodes ?? []);
      setCatalogPreview(Array.isArray(catalogRes) ? catalogRes.slice(0, 3) : []);
      setFraudData({
        securityAlerts: fraudRes.securityAlerts ?? [],
        disputedLedgers: fraudRes.disputedLedgers ?? [],
      });
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setGeoError(err instanceof Error ? err.message : 'Failed to query backend telemetry');
      }
    } finally {
      setLoading(false);
    }
  }, [maxMeters, selectedWard.lat, selectedWard.lng]);

  useEffect(() => {
    void loadLabData();
  }, [loadLabData]);

  return (
    <div className="space-y-6">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void loadLabData()}
          retrying={loading}
        />
      )}

      {geoError && (
        <div
          role="alert"
          className="border border-amber-200 bg-amber-50 rounded-lg p-3.5 text-xs font-medium text-amber-900"
        >
          {geoError}
        </div>
      )}

      {/* 1. PostGIS Proximity Query Explorer */}
      <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isSw
                ? 'Utafutaji wa PostGIS kwa Kata za Dar es Salaam'
                : 'Dar es Salaam Ward PostGIS Proximity Explorer'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5 font-mono text-xs">
              GET /api/v1/geospatial/stores-map-matrix?originLat={selectedWard.lat}&amp;originLng=
              {selectedWard.lng}&amp;maxDistanceMeters={maxMeters}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Dar es Salaam Ward"
              value={wardId}
              onChange={(e) => setWardId(e.target.value)}
              className="h-9 px-3 text-xs font-medium bg-white border border-slate-300 rounded-md text-slate-900"
            >
              {DAR_WARDS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Max Radius Meters"
              value={maxMeters}
              onChange={(e) => setMaxMeters(Number(e.target.value))}
              className="h-9 px-3 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
            >
              <option value={2500}>2,500 m</option>
              <option value={6000}>6,000 m</option>
              <option value={12000}>12,000 m</option>
              <option value={25000}>25,000 m</option>
            </select>
          </div>
        </div>

        {nearbyNodes.length === 0 ? (
          <EmptyStateCard
            locale={locale}
            titleSw="Hakuna Wafanyabiashara ndani ya kipenyo hiki"
            titleEn="No Merchants within this radius in PostGIS"
          />
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-md">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                  <th className="py-2 px-4">Code</th>
                  <th className="py-2 px-4">{isSw ? 'Mfanyabiashara' : 'Merchant'}</th>
                  <th className="py-2 px-4">{isSw ? 'Aina' : 'Tier'}</th>
                  <th className="py-2 px-4">Ward</th>
                  <th className="py-2 px-4 text-right">PostGIS Distance (m)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {nearbyNodes.map((v) => (
                  <tr key={v.merchantId} className="hover:bg-slate-50/70">
                    <td className="py-2 px-4 font-mono font-semibold text-slate-900">
                      {v.smsShortCode}
                    </td>
                    <td className="py-2 px-4 text-slate-800 inline-flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                      <span>{v.merchantName}</span>
                    </td>
                    <td className="py-2 px-4 text-slate-600">
                      {formatBusinessTierLabel(v.tier, locale)}
                    </td>
                    <td className="py-2 px-4 text-slate-600">{v.ward}</td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-900">
                      {v.distanceMeters.toLocaleString('en-US')} m
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 2. Ultra-Low Data Bundle Mode Live Switch (uses live Catalog SKUs) */}
      <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isSw
                ? 'Hali ya Kubana Data (Ultra-Low Data Bundle Mode)'
                : 'Ultra-Low Data Bundle Mode (DataSaverContext)'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {isSw
                ? 'Huzuia upakuaji wa picha kubwa kwenye mtandao wa 2G/3G na kuonyesha kadi nyepesi ya maandishi.'
                : 'Suppresses heavy image assets over expensive mobile bundles and renders zero-network SKU cards.'}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleLowDataMode}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isLowDataModeActive
                ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {isLowDataModeActive
                ? isSw
                  ? 'Hali ya Kubana Data: IMEWASHWA'
                  : 'Low-Data Mode: ON'
                : isSw
                  ? 'Hali ya Kubana Data: IMEZIMWA'
                  : 'Low-Data Mode: OFF'}
            </span>
          </button>
        </div>

        {catalogPreview.length === 0 ? (
          <EmptyStateCard
            locale={locale}
            titleSw="Hakuna bidhaa za katalogi kuu bado"
            titleEn="No Master Catalog items in PostgreSQL yet"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {catalogPreview.map((item) => (
              <OptimizedProductImage
                key={item.id}
                skuCode={item.canonicalSku}
                productName={isSw ? item.fixedNameSw : item.fixedNameEn}
                unitSummary={item.categoryCode}
                imageUrl={item.imagekitCdnUrl}
                estimatedFullSizeKb={180}
              />
            ))}
          </div>
        )}
      </section>

      {/* 3. Live 3-Strike Delivery Dispute & Security Audit Feed */}
      <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600" aria-hidden="true" />
              <span>
                {isSw
                  ? 'Tahadhari za Usalama na Mizozo 3 ya Madereva'
                  : '3-Strike Driver Disputes & Security Audit Feed'}
              </span>
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {isSw
                ? 'Inasoma moja kwa moja kutoka security_audit_logs na cash_delivery_ledgers zenye mizozo.'
                : 'Reads directly from security_audit_logs and DISPUTED cash_delivery_ledgers.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadLabData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isSw ? 'Onyesha Upya' : 'Refresh'}</span>
          </button>
        </div>

        {fraudData.securityAlerts.length === 0 && fraudData.disputedLedgers.length === 0 ? (
          <EmptyStateCard
            locale={locale}
            titleSw="Hakuna tahadhari za udanganyifu au mizozo"
            titleEn="No fraud escalations or disputed ledgers recorded"
          />
        ) : (
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
            {fraudData.securityAlerts.map((log) => (
              <div
                key={log.id}
                className={`px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 ${
                  log.severity === 'CRITICAL_3_STRIKE'
                    ? 'bg-red-50 text-red-900'
                    : 'bg-white text-slate-700'
                }`}
              >
                <span className="font-mono">
                  {log.eventType} · {log.actorName ?? log.actorPhone ?? 'System'}
                </span>
                <span className="font-mono tabular-nums text-slate-500 whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
            {fraudData.disputedLedgers.map((d) => (
              <div
                key={d.ledgerId}
                className="px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 bg-amber-50/70 text-amber-950"
              >
                <span className="font-mono">
                  DISPUTED #{d.orderRef} · Driver: {d.driverName} · Variance: TZS{' '}
                  {d.varianceTzs.toLocaleString('en-US')}
                </span>
                <span className="font-mono tabular-nums text-slate-600 whitespace-nowrap">
                  {new Date(d.updatedAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
