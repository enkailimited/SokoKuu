import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  MapPin,
  Navigation,
  PhoneCall,
  Search,
  ShieldCheck,
  Store,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  TANZANIA_REGIONS,
  extractRegionFromWard,
  loadManagedWholesalers,
  loadTenantGeospatialPermissions,
  toggleManagedWholesalerFlag,
  toggleTenantGeospatialPermission,
  type ManagedWholesaleProfile,
  type TanzaniaRegion,
  type TenantGeospatialPermission,
} from '../lib/sokoManagedState';

// ============================================================================
// AdminShopsDirectoryPanel.tsx
// Orodha ya Maduka Yote Yaliyokuwa Converted & Verified + Mipangilio ya Kila Duka
// ============================================================================
export function AdminShopsDirectoryPanel({ locale = 'sw' }: { locale?: Locale }) {
  const isSw = locale === 'sw';
  const [shops, setShops] = useState<ManagedWholesaleProfile[]>(() => loadManagedWholesalers());
  const [geoPerms, setGeoPerms] = useState<TenantGeospatialPermission[]>(() =>
    loadTenantGeospatialPermissions()
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<'ALL' | 'Wholesaler' | 'Retailer'>('ALL');
  const [regionFilter, setRegionFilter] = useState<'ALL' | TanzaniaRegion>('ALL');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  useEffect(() => {
    const syncAll = () => {
      setShops(loadManagedWholesalers());
      setGeoPerms(loadTenantGeospatialPermissions());
    };
    window.addEventListener('sokokuu:shops-updated', syncAll);
    window.addEventListener('sokokuu:geospatial-toggle-updated', syncAll);
    window.addEventListener('storage', syncAll);
    return () => {
      window.removeEventListener('sokokuu:shops-updated', syncAll);
      window.removeEventListener('sokokuu:geospatial-toggle-updated', syncAll);
      window.removeEventListener('storage', syncAll);
    };
  }, []);

  // Only list merchants that are Converted & Verified
  const convertedVerifiedShops = shops.filter(
    (s) => (s.isConverted ?? true) && (s.isVerified ?? true)
  );

  const handleToggleOrderRouting = (shop: ManagedWholesaleProfile) => {
    const updated = toggleManagedWholesalerFlag(shop.businessId);
    setShops(updated);
    const nextManaged = !shop.isPlatformManaged;
    setStatusNotice(
      isSw
        ? `${shop.businessName}: Mipangilio ya Oda sasa ni ${
            nextManaged ? 'Kupokelewa na Admin (Helpdesk)' : 'Moja kwa Moja kwa Mfanyabiashara'
          }.`
        : `${shop.businessName}: Order routing updated to ${
            nextManaged ? 'Admin Helpdesk Queue' : 'Direct Merchant Terminal'
          }.`
    );
  };

  const handleToggleMapAccess = (shop: ManagedWholesaleProfile) => {
    const geoId = shop.geoTenantId ?? shop.businessId;
    const updated = toggleTenantGeospatialPermission(geoId);
    setGeoPerms(updated);
    const currentGeo = updated.find((p) => p.tenantBusinessId === geoId);
    const isEnabled = Boolean(currentGeo?.geospatialMapEnabled);
    setStatusNotice(
      isSw
        ? `${shop.businessName}: Ruhusa ya Ramani ya Ukaribu ${
            isEnabled ? 'IMEWASHWA' : 'IMEFUNGWA'
          }.`
        : `${shop.businessName}: Proximity Map access ${
            isEnabled ? 'ENABLED' : 'LOCKED'
          }.`
    );
  };

  const filteredShops = convertedVerifiedShops.filter((shop) => {
    const tier = shop.roleTier ?? 'Wholesaler';
    const shopRegion = shop.region ?? extractRegionFromWard(shop.ward);
    const matchesTier = tierFilter === 'ALL' || tier === tierFilter;
    const matchesRegion = regionFilter === 'ALL' || shopRegion === regionFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      q.length === 0 ||
      shop.businessName.toLowerCase().includes(q) ||
      shop.ward.toLowerCase().includes(q) ||
      shopRegion.toLowerCase().includes(q);
    return matchesTier && matchesRegion && matchesSearch;
  });

  const adminManagedCount = convertedVerifiedShops.filter((s) => s.isPlatformManaged).length;

  return (
    <div className="space-y-4">
      {statusNotice && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-semibold text-emerald-950"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{statusNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-emerald-800 hover:text-emerald-950 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <Store className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {isSw
                  ? 'Wafanyabiashara & Mipangilio (Converted & Verified Merchants)'
                  : 'Converted & Verified Merchants Directory'}
              </h2>
              <p className="text-xs text-slate-500">
                {isSw
                  ? `Wafanyabiashara ${convertedVerifiedShops.length} waliothibitishwa · ${adminManagedCount} wanaelekeza oda kwa Admins`
                  : `${convertedVerifiedShops.length} verified merchants · ${adminManagedCount} routed to Admin Live Queue`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isSw ? 'Tafuta duka, kata, mkoa...' : 'Search shop, ward, region...'}
                className="pl-8 pr-3 py-1.5 min-h-[36px] text-xs rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value as 'ALL' | TanzaniaRegion)}
              aria-label={isSw ? 'Chagua Mkoa' : 'Select Region'}
              className="px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 cursor-pointer"
            >
              {TANZANIA_REGIONS.map((reg) => (
                <option key={reg.key} value={reg.key}>
                  {isSw ? reg.labelSw : reg.labelEn}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              {(
                [
                  { key: 'ALL', sw: 'Yote', en: 'All' },
                  { key: 'Wholesaler', sw: 'Jumla', en: 'Wholesalers' },
                  { key: 'Retailer', sw: 'Rejareja', en: 'Retailers' },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTierFilter(t.key)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    tierFilter === t.key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {isSw ? t.sw : t.en}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Converted & Verified Shops List + Settings */}
        {filteredShops.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
            {isSw
              ? 'Hakuna wafanyabiashara waliothibitishwa katika mkoa huu.'
              : 'No converted & verified merchants found for this region.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {filteredShops.map((shop) => {
              const geoId = shop.geoTenantId ?? shop.businessId;
              const geoRecord = geoPerms.find((p) => p.tenantBusinessId === geoId);
              const mapEnabled = Boolean(geoRecord?.geospatialMapEnabled);
              const shopRegion = shop.region ?? extractRegionFromWard(shop.ward);
              const tierLabel =
                (shop.roleTier ?? 'Wholesaler') === 'Wholesaler'
                  ? isSw
                    ? 'Duka la Jumla'
                    : 'Wholesale Hub'
                  : isSw
                    ? 'Duka la Rejareja'
                    : 'Retail Duka';

              return (
                <div
                  key={shop.businessId}
                  className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white hover:bg-slate-50/50"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs sm:text-sm font-bold text-slate-900">
                        {shop.businessName}
                      </span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {tierLabel}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800">
                        <ShieldCheck className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                        <span>{isSw ? 'Converted · Imethibitishwa' : 'Converted · Verified'}</span>
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                        <MapPin className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                        {shop.ward}
                      </span>
                      <span>·</span>
                      <span className="text-emerald-700 font-semibold">{shopRegion}</span>
                      {shop.latitude != null && shop.longitude != null && (
                        <>
                          <span>·</span>
                          <span className="font-mono text-slate-500">
                            {shop.latitude.toFixed(4)}, {shop.longitude.toFixed(4)}
                          </span>
                        </>
                      )}
                      <span>·</span>
                      <span>
                        {isSw ? 'Ilisasishwa:' : 'Updated:'} {shop.updatedAtEat}
                      </span>
                    </div>
                  </div>

                  {/* Per-Shop Settings Controls */}
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleOrderRouting(shop)}
                      className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors ${
                        shop.isPlatformManaged
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <PhoneCall
                        className={`w-3.5 h-3.5 ${
                          shop.isPlatformManaged ? 'text-emerald-600' : 'text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span>
                        {isSw ? 'Oda:' : 'Orders:'}{' '}
                        {shop.isPlatformManaged
                          ? isSw
                            ? 'Admin Pekee'
                            : 'Admin Managed'
                          : isSw
                            ? 'Mfanyabiashara Mwenyewe'
                            : 'Direct Merchant'}
                      </span>
                      {shop.isPlatformManaged ? (
                        <ToggleRight className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <ToggleLeft className="w-4 h-4 text-slate-400" aria-hidden="true" />
                      )}
                    </button>

                    {geoRecord && (
                      <button
                        type="button"
                        onClick={() => handleToggleMapAccess(shop)}
                        className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors ${
                          mapEnabled
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <Navigation
                          className={`w-3.5 h-3.5 ${
                            mapEnabled ? 'text-emerald-600' : 'text-slate-400'
                          }`}
                          aria-hidden="true"
                        />
                        <span>
                          {isSw ? 'Ramani:' : 'Map:'}{' '}
                          {mapEnabled
                            ? isSw
                              ? 'Imewashwa'
                              : 'Enabled'
                            : isSw
                              ? 'Imefungwa'
                              : 'Locked'}
                        </span>
                        {mapEnabled ? (
                          <ToggleRight className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                        ) : (
                          <ToggleLeft className="w-4 h-4 text-slate-400" aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
