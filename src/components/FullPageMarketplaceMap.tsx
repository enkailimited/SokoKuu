import { useEffect, useState } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useApiLoadingStatus,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  ArrowRight,
  CheckCircle2,
  Globe,
  Lock,
  MapPin,
  Navigation,
  ShieldAlert,
  ShieldCheck,
  Store,
  X,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  TANZANIA_REGIONS,
  isTenantGeospatialMapEnabled,
  loadVerifiedStoreGeoNodes,
  type SokoStoreGeoNode,
  type TanzaniaRegion,
} from '../lib/sokoManagedState';

const MAPS_API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? '';

function MapViewportController({
  center,
  zoom,
}: {
  center: { lat: number; lng: number };
  zoom: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    map.panTo(center);
    map.setZoom(zoom);
  }, [map, center, zoom]);

  return null;
}

function MapSdkCanvas({
  locale,
  stores,
  selectedStore,
  onSelectStore,
  viewportCenter,
  viewportZoom,
}: {
  locale: Locale;
  stores: SokoStoreGeoNode[];
  selectedStore: SokoStoreGeoNode | null;
  onSelectStore: (store: SokoStoreGeoNode) => void;
  viewportCenter: { lat: number; lng: number };
  viewportZoom: number;
}) {
  const isSw = locale === 'sw';
  const status = useApiLoadingStatus();

  if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) {
    return (
      <div className="w-full h-[440px] sm:h-[520px] bg-slate-50 flex flex-col items-center justify-center p-6 text-center space-y-2">
        <ShieldAlert className="w-6 h-6 text-amber-600" aria-hidden="true" />
        <p className="text-xs font-semibold text-slate-900">
          {isSw
            ? 'Imeshindwa kupakia ramani ya Google Maps. Kagua mtandao au ruhusa ya ufunguo.'
            : 'Unable to load interactive map canvas. Please check your network or API quota.'}
        </p>
        <p className="text-[11px] font-mono text-slate-500">
          Verified Store Nodes: {stores.length}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-[440px] sm:h-[520px]">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={viewportCenter}
        defaultZoom={viewportZoom}
        gestureHandling="greedy"
        disableDefaultUI={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
      >
        <MapViewportController center={viewportCenter} zoom={viewportZoom} />
        {stores.map((store) => {
          const isSelected = selectedStore?.businessId === store.businessId;
          return (
            <AdvancedMarker
              key={store.businessId}
              position={{ lat: store.latitude, lng: store.longitude }}
              title={`${store.businessName} (${store.ward})`}
              onClick={() => onSelectStore(store)}
            >
              <Pin
                background={isSelected ? '#0f172a' : '#059669'}
                borderColor={isSelected ? '#020617' : '#047857'}
                glyphColor="#ffffff"
                scale={isSelected ? 1.25 : 1}
              />
            </AdvancedMarker>
          );
        })}
      </GoogleMap>
    </div>
  );
}

// ============================================================================
// FullPageMarketplaceMap.tsx
// Ramani ya Maduka Yaliyowashwa & Kuthibitishwa (Converted & Verified)
// Inaruhusu kuchagua Mkoa (Dar es Salaam au Mikoa Mingine) na kuona maduka yake.
// ============================================================================
export function FullPageMarketplaceMap({
  locale = 'sw',
  authority,
  tenantBusinessId = 'ret-sinza-01',
  onRedirectToWorkspace,
  onSelectMerchantStorefront,
  onOpenShopsSettings,
}: {
  locale?: Locale;
  authority: 'SUPER_ADMIN' | 'WHOLESALER' | 'RETAILER' | 'DRIVER' | 'CONSUMER';
  tenantBusinessId?: string;
  onRedirectToWorkspace?: () => void;
  onSelectMerchantStorefront?: (store: SokoStoreGeoNode) => void;
  onOpenShopsSettings?: () => void;
}) {
  const isSw = locale === 'sw';
  const isAdmin = authority === 'SUPER_ADMIN';

  const [allVerifiedStores, setAllVerifiedStores] = useState<SokoStoreGeoNode[]>(() =>
    loadVerifiedStoreGeoNodes()
  );
  const [tenantAllowed, setTenantAllowed] = useState<boolean>(() =>
    isAdmin ? true : isTenantGeospatialMapEnabled(tenantBusinessId)
  );
  const [selectedRegion, setSelectedRegion] = useState<'ALL' | TanzaniaRegion>('Dar es Salaam');
  const [tierFilter, setTierFilter] = useState<'ALL' | 'Wholesale Hub' | 'Retail Duka'>('ALL');
  const [selectedStore, setSelectedStore] = useState<SokoStoreGeoNode | null>(
    () =>
      loadVerifiedStoreGeoNodes().find((s) => s.region === 'Dar es Salaam') ??
      loadVerifiedStoreGeoNodes()[0] ??
      null
  );
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);
  const [actionToast, setActionToast] = useState<string | null>(null);

  useEffect(() => {
    const syncAll = () => {
      setTenantAllowed(isAdmin ? true : isTenantGeospatialMapEnabled(tenantBusinessId));
      setAllVerifiedStores(loadVerifiedStoreGeoNodes());
    };

    window.addEventListener('sokokuu:geospatial-toggle-updated', syncAll);
    window.addEventListener('sokokuu:shops-updated', syncAll);
    window.addEventListener('storage', syncAll);
    return () => {
      window.removeEventListener('sokokuu:geospatial-toggle-updated', syncAll);
      window.removeEventListener('sokokuu:shops-updated', syncAll);
      window.removeEventListener('storage', syncAll);
    };
  }, [isAdmin, tenantBusinessId]);

  // Security Boundary Gate: Non-admin tenants default to FALSE and are blocked (HTTP 403)
  if (!isAdmin && !tenantAllowed) {
    return (
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <section className="bg-white border border-red-200 rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5 text-red-600" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-bold text-red-950">
                HTTP 403 FORBIDDEN —{' '}
                {isSw
                  ? 'Ramani ya Ukaribu Imezimwa kwa Akaunti Hii'
                  : 'Geospatial Map Access Disabled for Tenant'}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {isSw
                  ? 'Kwa usalama wa mtandao, kipengele cha Ramani ya Maduka kimefungwa kwa chaguo-msingi. Wasiliana na Msimamizi Mkuu kuiwasha kwenye Hifadhidata ya SokoKuu.'
                  : 'Geospatial map routing is disabled by default for merchant accounts. Only a Super Admin can enable this tenant permission inside SokoKuu Cloud SQL Cluster.'}
              </p>
            </div>
          </div>

          {onRedirectToWorkspace && (
            <button
              type="button"
              onClick={onRedirectToWorkspace}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
            >
              <span>{isSw ? 'Rudi Kwenye Kituo cha Kazi' : 'Return to Base Workspace'}</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </section>
      </div>
    );
  }

  const activeRegionConfig =
    TANZANIA_REGIONS.find((r) => r.key === selectedRegion) ?? TANZANIA_REGIONS[1];

  const visibleStores = allVerifiedStores.filter((s) => {
    const matchesRegion = selectedRegion === 'ALL' || s.region === selectedRegion;
    const matchesTier = tierFilter === 'ALL' || s.tierLabel === tierFilter;
    return matchesRegion && matchesTier;
  });

  const handleSelectRegion = (regionKey: 'ALL' | TanzaniaRegion) => {
    setSelectedRegion(regionKey);
    const matching = allVerifiedStores.filter(
      (s) =>
        (regionKey === 'ALL' || s.region === regionKey) &&
        (tierFilter === 'ALL' || s.tierLabel === tierFilter)
    );
    setSelectedStore(matching[0] ?? null);
    setDrawerOpen(matching.length > 0);
  };

  const handleSelectTier = (tier: 'ALL' | 'Wholesale Hub' | 'Retail Duka') => {
    setTierFilter(tier);
    const matching = allVerifiedStores.filter(
      (s) =>
        (selectedRegion === 'ALL' || s.region === selectedRegion) &&
        (tier === 'ALL' || s.tierLabel === tier)
    );
    setSelectedStore(matching[0] ?? null);
    setDrawerOpen(matching.length > 0);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header, Region Selector & Filter Bar */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <Navigation className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                {isSw
                  ? 'Ramani ya Maduka Yaliyothibitishwa (PostGIS & Google Maps)'
                  : 'Verified Shops Map'}
              </h2>
              <p className="text-[11px] font-mono text-slate-500">
                {isSw
                  ? `Eneo: ${activeRegionConfig.labelSw} · Maduka ${visibleStores.length} kuthibitishwa`
                  : `Region: ${activeRegionConfig.labelEn} · ${visibleStores.length} verified shops`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {isAdmin && onOpenShopsSettings && (
              <button
                type="button"
                onClick={onOpenShopsSettings}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Store className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span>{isSw ? 'Maduka & Mipangilio' : 'Shops & Settings'}</span>
              </button>
            )}
            {(['ALL', 'Wholesale Hub', 'Retail Duka'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => handleSelectTier(tier)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  tierFilter === tier
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {tier === 'ALL'
                  ? isSw
                    ? 'Yote'
                    : 'All Tiers'
                  : tier === 'Wholesale Hub'
                    ? isSw
                      ? 'Maduka ya Jumla'
                      : 'Wholesale Hubs'
                    : isSw
                      ? 'Maduka ya Rejareja'
                      : 'Retail Dukas'}
              </button>
            ))}
          </div>
        </div>

        {/* Region Switcher: Dar es Salaam vs Mikoa Mingine */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-100">
          <label
            htmlFor="marketplace-region-select"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            <span>{isSw ? 'Chagua Mkoa:' : 'Select Region:'}</span>
          </label>
          <select
            id="marketplace-region-select"
            aria-label={isSw ? 'Chagua Mkoa' : 'Select Region'}
            value={selectedRegion}
            onChange={(e) => handleSelectRegion(e.target.value as 'ALL' | TanzaniaRegion)}
            className="h-9 min-w-[220px] px-3 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 cursor-pointer"
          >
            {TANZANIA_REGIONS.map((region) => {
              const count =
                region.key === 'ALL'
                  ? allVerifiedStores.length
                  : allVerifiedStores.filter((s) => s.region === region.key).length;
              return (
                <option key={region.key} value={region.key}>
                  {isSw ? region.labelSw : region.labelEn} ({count})
                </option>
              );
            })}
          </select>
        </div>

        {/* Verified Store Quick Selector in Active Region */}
        {visibleStores.length === 0 ? (
          <div className="text-xs text-slate-500 py-2">
            {isSw
              ? 'Hakuna maduka yaliyothibitishwa katika chaguo hili.'
              : 'No verified shops in this filter.'}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visibleStores.map((store) => {
              const active = selectedStore?.businessId === store.businessId;
              return (
                <button
                  key={store.businessId}
                  type="button"
                  onClick={() => {
                    setSelectedStore(store);
                    setDrawerOpen(true);
                  }}
                  className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                    active
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-semibold'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <img
                    src={store.logoUrl}
                    alt={store.businessName}
                    referrerPolicy="no-referrer"
                    className="w-5 h-5 rounded-full object-cover border border-slate-200 shrink-0"
                  />
                  <span>{store.businessName}</span>
                  <span className="text-[11px] text-slate-500">· {store.region}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {actionToast && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-semibold text-emerald-950"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{actionToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionToast(null)}
            className="text-emerald-800 hover:text-emerald-950 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Full-Page Responsive Map Container + Slide-Up Preview Card Drawer */}
      <section className="relative bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {MAPS_API_KEY ? (
          <APIProvider
            apiKey={MAPS_API_KEY}
            libraries={['marker']}
            language={isSw ? 'sw' : 'en'}
            region="TZ"
          >
            <MapSdkCanvas
              locale={locale}
              stores={visibleStores}
              selectedStore={selectedStore}
              onSelectStore={(store) => {
                setSelectedStore(store);
                setDrawerOpen(true);
              }}
              viewportCenter={activeRegionConfig.center}
              viewportZoom={activeRegionConfig.zoom}
            />
          </APIProvider>
        ) : (
          /* Clean Regional PostGIS Matrix Fallback when Maps API key is absent */
          <div className="w-full h-[440px] sm:h-[520px] bg-slate-50 p-5 flex flex-col justify-between overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="text-xs font-semibold text-slate-700 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                <span>
                  {activeRegionConfig.labelSw} — PostGIS Node Matrix (EPSG:4326)
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {visibleStores.length} Verified Nodes
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4">
              {visibleStores.map((store) => {
                const isSelected = selectedStore?.businessId === store.businessId;
                return (
                  <button
                    key={store.businessId}
                    type="button"
                    onClick={() => {
                      setSelectedStore(store);
                      setDrawerOpen(true);
                    }}
                    className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer flex items-center gap-3 ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-600 shadow-sm'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <img
                      src={store.logoUrl}
                      alt={store.businessName}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {store.businessName}
                      </div>
                      <div className="text-[11px] text-slate-600 truncate">
                        {store.ward} · {store.region}
                      </div>
                      <div className="text-[11px] font-mono text-emerald-700 tabular-nums mt-0.5">
                        {store.latitude.toFixed(4)}, {store.longitude.toFixed(4)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="h-24" />
          </div>
        )}

        {/* Responsive Slide-Up Store Preview Card Drawer */}
        {drawerOpen && selectedStore && (
          <div className="absolute bottom-3 inset-x-3 sm:inset-x-4 z-20 transition-transform duration-200">
            <div className="bg-white border border-slate-200 rounded-xl shadow-xl p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                <img
                  src={selectedStore.logoUrl}
                  alt={selectedStore.businessName}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-full object-cover border border-slate-200 shrink-0 bg-slate-50"
                />
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 truncate">
                      {selectedStore.businessName}
                    </h3>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {selectedStore.tierLabel}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                      <span>{isSw ? 'Verified' : 'Verified'}</span>
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                      {selectedStore.ward}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-emerald-700">{selectedStore.region}</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono text-slate-500 tabular-nums">
                      {selectedStore.activeSkusCount} SKUs
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (onSelectMerchantStorefront) {
                      onSelectMerchantStorefront(selectedStore);
                    } else {
                      setActionToast(
                        isSw
                          ? `Umefungua duka: ${selectedStore.businessName} (${selectedStore.region}).`
                          : `Opened storefront context for ${selectedStore.businessName} (${selectedStore.region}).`
                      );
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                >
                  <Store className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSw ? 'Fungua Duka' : 'Open Storefront'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
                  aria-label="Close store preview"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
