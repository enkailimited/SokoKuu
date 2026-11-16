import { useState } from 'react';
import { MapPin, Wifi, AlertOctagon, RotateCcw } from 'lucide-react';
import { useDataSaver } from '../context/DataSaverContext';
import { OptimizedProductImage } from './OptimizedProductImage';
import type { Locale } from '../data/i18n';

const DAR_WARDS = [
  { id: 'sinza', name: 'Sinza Kwaremy', lat: -6.7845, lng: 39.2224 },
  { id: 'kinondoni', name: 'Kinondoni Studio', lat: -6.7875, lng: 39.2621 },
  { id: 'temeke', name: 'Temeke Mwisho', lat: -6.8669, lng: 39.2672 },
  { id: 'tabata', name: 'Tabata Segerea', lat: -6.8264, lng: 39.1932 },
];

const WHOLESALE_VENDORS = [
  { code: 'S12', name: 'Kariakoo Msimbazi Hub', ward: 'Kariakoo', lat: -6.8235, lng: 39.2764 },
  { code: 'S04', name: 'Congo St. Wholesale', ward: 'Kariakoo', lat: -6.8211, lng: 39.2749 },
  { code: 'S19', name: 'Ilala Boma Grain Depot', ward: 'Ilala', lat: -6.8281, lng: 39.2602 },
  { code: 'S24', name: 'Sinza Mori Bulk Store', ward: 'Sinza', lat: -6.7812, lng: 39.2298 },
  { code: 'S31', name: 'Temeke Sudan Distributors', ward: 'Temeke', lat: -6.8615, lng: 39.2611 },
];

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

interface AlertLog {
  id: string;
  severity: 'INFO' | 'CRITICAL_3_STRIKE';
  message: string;
  time: string;
}

export function OptimizationLabPanel({ locale }: { locale: Locale }) {
  const isSw = locale === 'sw';
  const { isLowDataModeActive, toggleLowDataMode } = useDataSaver();

  const [wardId, setWardId] = useState('sinza');
  const [maxMeters, setMaxMeters] = useState(6000);

  const [driverDisputes, setDriverDisputes] = useState(1);
  const [alertLogs, setAlertLogs] = useState<AlertLog[]>([
    {
      id: 'init',
      severity: 'INFO',
      message: 'Dispute #1 logged for Driver Hassan Bakari (Order R4T7N2W5 · TZS 282,000 variance). Threshold: 3 in 24h.',
      time: '15:18 EAT',
    },
  ]);

  const selectedWard = DAR_WARDS.find((w) => w.id === wardId) ?? DAR_WARDS[0];
  const nearbyVendors = WHOLESALE_VENDORS.map((v) => ({
    ...v,
    distanceMeters: haversineMeters(selectedWard.lat, selectedWard.lng, v.lat, v.lng),
  }))
    .filter((v) => v.distanceMeters <= maxMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const triggerDisputeEvent = () => {
    const nextCount = driverDisputes + 1;
    setDriverDisputes(nextCount);
    const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' EAT';

    if (nextCount >= 3) {
      setAlertLogs((prev) => [
        {
          id: crypto.randomUUID(),
          severity: 'CRITICAL_3_STRIKE',
          message: `NEXTSMS ADMIN ALERT SENT: Driver Hassan Bakari reached ${nextCount} DISPUTED ledgers in 24h. Account flagged for audit.`,
          time: now,
        },
        ...prev,
      ]);
    } else {
      setAlertLogs((prev) => [
        {
          id: crypto.randomUUID(),
          severity: 'INFO',
          message: `Dispute #${nextCount} recorded for Hassan Bakari (TZS 94,000 variance). Below 3-strike SMS escalation threshold.`,
          time: now,
        },
        ...prev,
      ]);
    }
  };

  const resetDisputes = () => {
    setDriverDisputes(1);
    setAlertLogs([
      {
        id: 'reset',
        severity: 'INFO',
        message: 'Dispute #1 logged for Driver Hassan Bakari (Order R4T7N2W5 · TZS 282,000 variance). Threshold: 3 in 24h.',
        time: '15:18 EAT',
      },
    ]);
  };

  return (
    <div className="space-y-6">
      {/* 1. PostGIS Proximity Query Simulator */}
      <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isSw
                ? 'Utafutaji wa PostGIS kwa Kata za Dar es Salaam'
                : 'Dar es Salaam Ward PostGIS Proximity Explorer'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5 font-mono text-xs">
              SELECT * FROM get_businesses_ordered_by_proximity({selectedWard.lat}, {selectedWard.lng}, {maxMeters});
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
            </select>
          </div>
        </div>

        {nearbyVendors.length === 0 ? (
          <div className="text-xs text-slate-500 py-4 text-center border border-slate-200 rounded-md">
            {isSw
              ? 'Hakuna duka la jumla ndani ya umbali huu. Panua kipenyo.'
              : 'No wholesale hubs within this radius. Increase max_distance_meters.'}
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-md">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                  <th className="py-2 px-4">Code</th>
                  <th className="py-2 px-4">Wholesale Hub</th>
                  <th className="py-2 px-4">Ward</th>
                  <th className="py-2 px-4 text-right">Proximity Distance (m)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {nearbyVendors.map((v) => (
                  <tr key={v.code} className="hover:bg-slate-50/70">
                    <td className="py-2 px-4 font-mono font-semibold text-slate-900">{v.code}</td>
                    <td className="py-2 px-4 text-slate-800 inline-flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                      <span>{v.name}</span>
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

      {/* 2. Ultra-Low Data Bundle Mode Live Switch */}
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
                : 'Suppresses heavy image assets over expensive mobile bundles and falls back to zero-network SKU cards.'}
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <OptimizedProductImage
            skuCode="P01"
            productName="Azania Wheat Flour (2kg)"
            unitSummary="24 units / Carton"
            priceTzs={81600}
            estimatedFullSizeKb={210}
          />
          <OptimizedProductImage
            skuCode="P02"
            productName="Korie Cooking Oil (1L)"
            unitSummary="20 bottles / Carton"
            priceTzs={94000}
            estimatedFullSizeKb={185}
          />
          <OptimizedProductImage
            skuCode="P04"
            productName="Kilombero Sugar (1kg)"
            unitSummary="12 packs / Dozen"
            priceTzs={39600}
            estimatedFullSizeKb={165}
          />
        </div>
      </section>

      {/* 3. Spring Boot 3-Strike Dispute Alert Listener Simulator */}
      <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isSw
                ? 'Mtambo wa Tahadhari za Mizozo (DisputeAlertListener)'
                : '3-Strike Delivery Dispute Alert Listener'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {isSw
                ? 'Dereva akifikisha mizozo 3 ndani ya saa 24, Spring Boot hutuma tahadhari kwa wasimamizi via NextSMS.'
                : 'Triggers @Async administrator NextSMS escalation when a driver accumulates >= 3 Disputed cash variances in 24h.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={triggerDisputeEvent}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-amber-700 rounded-md hover:bg-amber-800 whitespace-nowrap cursor-pointer"
            >
              <AlertOctagon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {isSw ? 'Tuma Tukio la Mzozo' : 'Emit DeliveryDisputeEvent'} ({driverDisputes}/3)
              </span>
            </button>
            <button
              type="button"
              onClick={resetDisputes}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? 'Weka Upya' : 'Reset'}</span>
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
          {alertLogs.map((log) => (
            <div
              key={log.id}
              className={`px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 ${
                log.severity === 'CRITICAL_3_STRIKE' ? 'bg-red-50 text-red-900' : 'bg-white text-slate-700'
              }`}
            >
              <span className="font-mono">{log.message}</span>
              <span className="font-mono tabular-nums text-slate-500 whitespace-nowrap">{log.time}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
