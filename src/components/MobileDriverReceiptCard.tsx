import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Crosshair,
  ExternalLink,
  LoaderCircle,
  Lock,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Route as RouteIcon,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import L from 'leaflet';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Locale } from '../data/i18n';
import { formatOrderStatusLabel } from '../lib/sokoManagedState';
import { SokoApiClient, SokoHttpError, isSokoNetworkError } from '../services/sokoApiClient';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import { IsolatedQrVerificationTerminal } from './IsolatedQrVerificationTerminal';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface WaypointMarker {
  step: number;
  label: string;
  hint: string;
  lat: number | null;
  lng: number | null;
}

interface ActiveDeliveryStop {
  stop: number;
  orderId: string;
  orderRef: string;
  status: 'DISPATCHED';
  expectedCashTzs: number;
  paymentMethod: string;
  customer: { name: string | null; phoneE164: string | null };
  pickup: {
    latitude: number;
    longitude: number;
    name: string;
    ward: string | null;
    streetAddress: string | null;
    streetLandmark: string | null;
    phoneE164?: string | null;
  };
  dropoff: {
    latitude: number;
    longitude: number;
    name: string;
    ward: string | null;
    streetAddress: string | null;
    streetLandmark: string | null;
  };
  routeWaypoints: WaypointMarker[];
  verification_status: string;
  placedAt: string | null;
  dispatchedAt: string | null;
}

function formatTzs(value: number): string {
  return `${Math.max(0, Math.round(value)).toLocaleString('en-US')} TZS`;
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function createNumberedIcon(step: number, color = '#0054A6') {
  return L.divIcon({
    className: 'soko-waypoint-icon',
    html: `<div style="background:${color};color:#fff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">${step}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function FitRouteBounds({
  points,
}: {
  points: Array<[number, number]>;
}) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
    map.fitBounds(bounds.pad(0.2), { animate: true, maxZoom: 16 });
  }, [map, points.map((p) => p.join(',')).join('|')]);
  return null;
}

function LiveDriverMarker({ position }: { position: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      // keep driver visible softly without forcing refit every tick
      map.panInside([position.lat, position.lng], { padding: [40, 40] });
    }
  }, [map, position?.lat, position?.lng]);
  if (!position) return null;
  return (
    <>
      <CircleMarker
        center={[position.lat, position.lng]}
        radius={10}
        pathOptions={{ color: '#10B981', fillColor: '#10B981', fillOpacity: 0.95, weight: 3 }}
      >
        <Popup>Dereva yuko hapa sasa / Driver live location</Popup>
      </CircleMarker>
      <CircleMarker
        center={[position.lat, position.lng]}
        radius={22}
        pathOptions={{ color: '#10B981', fillColor: '#10B981', fillOpacity: 0.12, weight: 1 }}
      />
    </>
  );
}

export function MobileDriverReceiptCard({ locale = 'sw' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [stops, setStops] = useState<ActiveDeliveryStop[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendOffline, setBackendOffline] = useState(false);
  const [driverPosition, setDriverPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [checkedWaypoints, setCheckedWaypoints] = useState<Record<string, boolean>>({});
  const watchIdRef = useRef<number | null>(null);

  const selectedStop = useMemo(
    () => stops.find((s) => s.orderId === selectedOrderId) ?? stops[0] ?? null,
    [stops, selectedOrderId],
  );

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoError(isSw ? 'Kifaa hakina GPS.' : 'Geolocation is unavailable on this device.');
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setDriverPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoError(null);
      },
      () => {
        setGeoError(
          isSw
            ? 'Imeshindikana kupata eneo la dereva kwa sasa.'
            : 'Unable to read live driver location right now.',
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [isSw]);

  const loadDeliveries = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);
    try {
      const res = await SokoApiClient.get<{
        count?: number;
        route?: ActiveDeliveryStop[];
        deliveries?: ActiveDeliveryStop[];
      }>('/driver/deliveries/active');
      const list = (res.route || res.deliveries || []) as ActiveDeliveryStop[];
      setStops(list);
      setBackendOffline(false);
      setSelectedOrderId((prev) => (prev && list.some((s) => s.orderId === prev) ? prev : list[0]?.orderId ?? null));
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setStops([]);
      } else {
        setError(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : isSw
                ? 'Imeshindikana kupakia oda za usafirishaji.'
                : 'Failed to load active deliveries.',
        );
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [isSw]);

  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  const origin = driverPosition
    ? driverPosition
    : selectedStop
      ? { lat: selectedStop.pickup.latitude, lng: selectedStop.pickup.longitude }
      : null;
  const destination = selectedStop
    ? { lat: selectedStop.dropoff.latitude, lng: selectedStop.dropoff.longitude }
    : null;

  const distanceKm = useMemo(() => {
    if (!origin || !destination) return null;
    const km = haversineKm(origin, destination);
    return Number.isFinite(km) ? km : null;
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng]);

  const etaMinutes = useMemo(() => {
    if (distanceKm == null) return null;
    // simple city-driving estimate
    const minutes = Math.round((distanceKm / 22) * 60 + 6);
    return Math.max(5, minutes);
  }, [distanceKm]);

  const polylinePositions = useMemo(() => {
    if (!selectedStop) return [] as Array<[number, number]>;
    const pts: Array<[number, number]> = [];
    if (origin) pts.push([origin.lat, origin.lng]);
    for (const wp of selectedStop.routeWaypoints || []) {
      if (typeof wp.lat === 'number' && typeof wp.lng === 'number') {
        pts.push([wp.lat, wp.lng]);
      }
    }
    pts.push([selectedStop.dropoff.latitude, selectedStop.dropoff.longitude]);
    return pts;
  }, [selectedStop, origin?.lat, origin?.lng]);

  const googleMapsUrl = useMemo(() => {
    if (!selectedStop) return 'https://google.com/maps';
    const dest = `${selectedStop.dropoff.latitude},${selectedStop.dropoff.longitude}`;
    const wpCoords = (selectedStop.routeWaypoints || [])
      .filter((w) => typeof w.lat === 'number' && typeof w.lng === 'number')
      .map((w) => `${w.lat},${w.lng}`)
      .join('|');
    const originParam = origin ? `${origin.lat},${origin.lng}` : '';
    const params = new URLSearchParams({
      api: '1',
      destination: dest,
      travelmode: 'driving',
    });
    if (originParam) params.set('origin', originParam);
    if (wpCoords) params.set('waypoints', wpCoords);
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }, [selectedStop, origin?.lat, origin?.lng]);

  const fitPoints = useMemo(() => {
    const pts = [...polylinePositions];
    if (driverPosition) pts.push([driverPosition.lat, driverPosition.lng]);
    return pts;
  }, [polylinePositions, driverPosition?.lat, driverPosition?.lng]);

  const toggleWaypoint = (key: string) => {
    setCheckedWaypoints((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="min-h-[100dvh] w-full bg-slate-100 p-4 md:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
              <Truck className="w-5 h-5 text-emerald-600" aria-hidden="true" />
              {isSw ? 'Usafirishaji wa Dereva (Bolt Navigation)' : 'Driver Deliveries (Bolt Navigation)'}
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              {isSw
                ? 'Oda halisi kutoka mfumo wa SokoKuu, ramani ya njia, na alama za kufika kwa mteja.'
                : 'Live SokoKuu deliveries with route map and step-by-step waypoint markers.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDeliveries(true)}
            className="min-h-[40px] px-3 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold inline-flex items-center gap-2 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {isSw ? 'Sasisha' : 'Refresh'}
          </button>
        </div>

        {backendOffline && (
          <BackendOfflineBanner locale={locale} onRetry={() => void loadDeliveries()} retrying={isLoading} />
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 text-red-600" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600 inline-flex items-center justify-center gap-2 w-full">
            <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" />
            {isSw ? 'Inapakia oda za moja kwa moja...' : 'Loading live deliveries...'}
          </div>
        ) : stops.length === 0 ? (
          <EmptyStateCard
            locale={locale}
            titleSw="Hakuna oda za usafirishaji kwa sasa"
            titleEn="No active deliveries right now"
            descriptionSw="Utakapo pangiwa oda hai (DISPATCHED) itaonekana hapa moja kwa moja kutoka mfumo."
            descriptionEn="When you are assigned active DISPATCHED orders, they will appear here live from the system."
          />
        ) : (
          <>
            {/* Interactive Bolt-style map */}
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Navigation className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  {isSw ? 'Ramani ya Safari (Bolt-style)' : 'Live Route Map'}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
                  <span className="inline-flex items-center gap-1.5">
                    <RouteIcon className="w-3.5 h-3.5 text-[#0054A6]" aria-hidden="true" />
                    {distanceKm != null ? `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km` : '-- km'}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Crosshair className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    {etaMinutes != null
                      ? isSw
                        ? `ETA ~ dk ${etaMinutes}`
                        : `ETA ~ ${etaMinutes} min`
                      : isSw
                        ? 'ETA --'
                        : 'ETA --'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {driverPosition
                      ? isSw
                        ? 'GPS ya dereva iko hai'
                        : 'Driver GPS live'
                      : geoError || (isSw ? 'Inasubiri GPS...' : 'Waiting for GPS...')}
                  </span>
                </div>
              </div>
              <div className="h-[320px] md:h-[380px]">
                <MapContainer
                  center={[destination?.lat ?? -6.7924, destination?.lng ?? 39.2083]}
                  zoom={13}
                  scrollWheelZoom
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {fitPoints.length > 0 && <FitRouteBounds points={fitPoints} />}
                  {polylinePositions.length >= 2 && (
                    <Polyline
                      positions={polylinePositions}
                      pathOptions={{ color: '#0054A6', weight: 5, opacity: 0.85 }}
                    />
                  )}
                  <LiveDriverMarker position={driverPosition} />
                  {selectedStop && (
                    <>
                      <Marker position={[selectedStop.pickup.latitude, selectedStop.pickup.longitude]}>
                        <Popup>
                          <strong>{isSw ? 'Kuchukua (Mfanyabiashara)' : 'Pickup (Merchant)'}</strong>
                          <br />
                          {selectedStop.pickup.name}
                        </Popup>
                      </Marker>
                      <Marker
                        position={[selectedStop.dropoff.latitude, selectedStop.dropoff.longitude]}
                        icon={createNumberedIcon(Math.max(1, (selectedStop.routeWaypoints?.length || 0) + 1), '#10B981')}
                      >
                        <Popup>
                          <strong>{isSw ? 'Mteja (Mwisho)' : 'Customer (Drop-off)'}</strong>
                          <br />
                          {selectedStop.dropoff.name}
                        </Popup>
                      </Marker>
                      {(selectedStop.routeWaypoints || []).map((wp, i) => {
                        if (typeof wp.lat !== 'number' || typeof wp.lng !== 'number') return null;
                        const step = wp.step || i + 1;
                        return (
                          <Marker key={`${selectedStop.orderId}-wp-${step}`} position={[wp.lat, wp.lng]} icon={createNumberedIcon(step)}>
                            <Popup>
                              <strong>
                                {isSw ? 'Alama' : 'Waypoint'} {step}: {wp.label}
                              </strong>
                              <br />
                              {wp.hint}
                            </Popup>
                          </Marker>
                        );
                      })}
                    </>
                  )}
                </MapContainer>
              </div>
              {selectedStop && (
                <div className="p-3 border-t border-slate-100 flex flex-wrap gap-2">
                  <a
                    href={selectedStop.customer.phoneE164 ? `tel:${selectedStop.customer.phoneE164}` : undefined}
                    className={`min-h-[42px] px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 ${
                      selectedStop.customer.phoneE164
                        ? 'bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 cursor-pointer'
                        : 'bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                    aria-disabled={!selectedStop.customer.phoneE164}
                  >
                    <Phone className="w-4 h-4" aria-hidden="true" />
                    {isSw ? 'Piga Simu Mteja' : 'Call Customer'}
                  </a>
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[42px] px-4 rounded-lg text-sm font-bold inline-flex items-center gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <ExternalLink className="w-4 h-4" aria-hidden="true" />
                    {isSw ? 'Anza Safari (Google Maps Navigation)' : 'Start Trip (Google Maps Navigation)'}
                  </a>
                </div>
              )}
            </section>

            {/* Active route stops / queue */}
            <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                {isSw ? 'Foleni ya Usafirishaji Hai (Route Stops)' : 'Active Delivery Route'}
              </h3>
              <div className="space-y-2">
                {stops.map((stop) => {
                  const active = selectedStop?.orderId === stop.orderId;
                  return (
                    <button
                      key={stop.orderId}
                      type="button"
                      onClick={() => setSelectedOrderId(stop.orderId)}
                      className={`w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                        active ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#0054A6] text-white text-xs font-bold">
                              {stop.stop}
                            </span>
                            <span className="font-mono text-xs font-bold text-slate-900">{stop.orderRef}</span>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                              {formatOrderStatusLabel(stop.status, locale)}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-slate-900 mt-1 truncate">{stop.dropoff.name}</p>
                          <p className="text-xs text-slate-600 truncate">
                            <MapPin className="w-3 h-3 inline mr-1 text-slate-400" aria-hidden="true" />
                            {stop.dropoff.ward || stop.dropoff.streetLandmark || stop.dropoff.streetAddress || (isSw ? 'Eneo la mteja' : 'Customer area')}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold text-slate-900">{formatTzs(stop.expectedCashTzs)}</div>
                          <div className="text-[11px] text-slate-500">{stop.paymentMethod}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Waypoint checklist + simplified PIN & cash confirmation */}
            {selectedStop && (
              <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <RouteIcon className="w-4 h-4 text-[#0054A6]" aria-hidden="true" />
                    {isSw ? 'Alama za Njia ya Kufika Kwa Mteja' : 'Step-by-step Route Waypoints'}
                  </h3>
                  <p className="text-xs text-slate-600 mt-1">
                    {isSw
                      ? 'Fuata alama hizi za mfanyabiashara hadi ufike kwa mteja.'
                      : 'Follow these merchant-saved markers to reach the customer easily.'}
                  </p>
                  <div className="mt-3 space-y-2">
                    {(selectedStop.routeWaypoints && selectedStop.routeWaypoints.length > 0
                      ? selectedStop.routeWaypoints
                      : [
                          {
                            step: 1,
                            label: isSw ? 'Fuata ramani hadi eneo la mteja' : 'Follow map to customer area',
                            hint: isSw ? 'Tumia ramani na upigie mteja ukiwa karibu.' : 'Use the map and call the customer when nearby.',
                            lat: null,
                            lng: null,
                          },
                        ]
                    ).map((wp, idx) => {
                      const step = wp.step || idx + 1;
                      const key = `${selectedStop.orderId}:${step}:${wp.label}`;
                      const checked = !!checkedWaypoints[key];
                      return (
                        <label
                          key={key}
                          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
                            checked ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleWaypoint(key)}
                            className="mt-1 h-4 w-4 accent-emerald-600"
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900">
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#0054A6] text-white text-[11px] font-bold mr-2">
                                {step}
                              </span>
                              {wp.label}
                            </div>
                            {wp.hint ? <p className="text-xs text-slate-600 mt-0.5">{wp.hint}</p> : null}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                    {isSw ? 'Uthibitisho wa Dereva (PIN & Fedha Taslimu)' : 'Driver Confirmation (PIN & Cash)'}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] text-slate-500 font-semibold">{isSw ? 'Kiasi cha Kukusanya' : 'Cash to Collect'}</div>
                      <div className="font-bold text-slate-900">{formatTzs(selectedStop.expectedCashTzs)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] text-slate-500 font-semibold">{isSw ? 'Mteja' : 'Customer'}</div>
                      <div className="font-semibold text-slate-900 truncate">{selectedStop.customer.name || '—'}</div>
                      <div className="text-xs text-slate-600 font-mono">{selectedStop.customer.phoneE164 || '—'}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[11px] text-slate-500 font-semibold">{isSw ? 'Hali ya Uthibitisho' : 'Verification'}</div>
                      <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                        {String(selectedStop.verification_status).toUpperCase().includes('VERIFIED') ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                        ) : (
                          <Lock className="w-4 h-4 text-amber-600" aria-hidden="true" />
                        )}
                        <span>{selectedStop.verification_status || 'PENDING'}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">
                    {isSw
                      ? 'Thibitisha kupokea fedha na uwasilishe PIN ya tarakimu 4 ya mteja/dereva kwenye hatua ya mwisho ya kukabidhi.'
                      : 'Confirm cash received and complete the 4-digit buyer/driver PIN verification at final handover.'}
                  </p>
                  <IsolatedQrVerificationTerminal
                    locale={locale}
                    expectedCashTzs={Number(selectedStop.expectedCashTzs ?? 0)}
                  />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
