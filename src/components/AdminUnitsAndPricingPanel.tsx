import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  DollarSign,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ToggleLeft,
  ToggleRight,
  TrendingUp,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import type { GlobalCatalogEntry } from '../lib/sokoManagedState';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import { PricingTemplateAttachmentEditor } from './AdminPricingTemplatesPanel';
import { formatQuantaMeasurement } from '../utils/formatProductUnit';

export interface BackendSystemUnit {
  id: string;
  unitCode: string;
  category: 'WEIGHT' | 'VOLUME' | 'PACKAGING';
  nameSw: string;
  nameEn: string;
  abbreviation: string;
  allowFractional: boolean;
  baseReferenceCode: string | null;
  isActive: boolean;
}

export interface BackendGlobalProductUnit {
  id: string;
  globalCatalogId: string;
  systemUnitId: string;
  quarterQuantaPerUnit: number;
  displayLabelSw: string;
  displayLabelEn: string;
  isWholesaleUnit: boolean;
  isActive: boolean;
  systemUnit: BackendSystemUnit;
}

export interface BackendPricingProfile {
  id: string;
  profileCode: string;
  profileType: 'RETAIL' | 'WHOLESALE' | 'REGIONAL' | 'PROMOTIONAL';
  nameSw: string;
  nameEn: string;
}

export interface BackendStandardPrice {
  id: string;
  globalProductUnitId: string;
  pricingProfileId: string;
  profileCode: string;
  profileType: 'RETAIL' | 'WHOLESALE' | 'REGIONAL' | 'PROMOTIONAL';
  version: number;
  minQty: number;
  maxQty: number | null;
  standardPriceTzs: number;
  isActive: boolean;
}


export function AdminUnitsAndPricingPanel({
  locale = 'sw',
  initialCatalogId,
}: {
  locale?: Locale;
  initialCatalogId?: string;
}) {
  const isSw = locale === 'sw';

  const [units, setUnits] = useState<BackendSystemUnit[]>([]);
  const [catalog, setCatalog] = useState<GlobalCatalogEntry[]>([]);
  const [profiles, setProfiles] = useState<BackendPricingProfile[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>(initialCatalogId ?? '');

  const [productUnits, setProductUnits] = useState<BackendGlobalProductUnit[]>([]);
  const [standardPrices, setStandardPrices] = useState<BackendStandardPrice[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<
    Record<string, { retailPriceTzs: string; wholesalePriceTzs: string; wholesaleMinQty: string }>
  >({});

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [searchUnit, setSearchUnit] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'WEIGHT' | 'VOLUME' | 'PACKAGING'>(
    'ALL'
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // New System Unit Modal State
  const [showAddUnitModal, setShowAddUnitModal] = useState<boolean>(false);
  const [newUnitCode, setNewUnitCode] = useState<string>('');
  const [newCategory, setNewCategory] = useState<'WEIGHT' | 'VOLUME' | 'PACKAGING'>('PACKAGING');
  const [newNameSw, setNewNameSw] = useState<string>('');
  const [newNameEn, setNewNameEn] = useState<string>('');
  const [newAbbr, setNewAbbr] = useState<string>('');
  const [newBaseRef, setNewBaseRef] = useState<string>('QUANTA_250G');
  const [newAllowsFractional, setNewAllowsFractional] = useState<boolean>(false);

  // Define / Edit Product Unit State
  const [showProductUnitModal, setShowProductUnitModal] = useState<boolean>(false);
  const [editingProductUnitId, setEditingProductUnitId] = useState<string | null>(null);
  const [puSystemUnitId, setPuSystemUnitId] = useState<string>('');
  const [puQuarterQuanta, setPuQuarterQuanta] = useState<number>(100);
  const [puLabelSw, setPuLabelSw] = useState<string>('');
  const [puLabelEn, setPuLabelEn] = useState<string>('');
  const [puIsWholesale, setPuIsWholesale] = useState<boolean>(true);

  const loadBaseRegistry = useCallback(async () => {
    setIsLoading(true);
    setErrorBanner(null);
    try {
      const [unitRows, catalogRows, profileRows] = await Promise.all([
        SokoApiClient.get<BackendSystemUnit[]>('/admin/units?includeInactive=true'),
        SokoApiClient.get<
          Array<{
            id: string;
            canonicalSku: string;
            fixedNameSw: string;
            fixedNameEn: string;
            categoryCode: string;
            imagekitCdnUrl: string;
            staticImageUrl: string;
            clonedByStoresCount: number;
            updatedAt?: string;
          }>
        >('/marketplace/catalog'),
        SokoApiClient.get<BackendPricingProfile[]>('/admin/pricing/profiles'),
      ]);

      setUnits(Array.isArray(unitRows) ? unitRows : []);
      setProfiles(Array.isArray(profileRows) ? profileRows : []);

      const mappedCatalog: GlobalCatalogEntry[] = (catalogRows || []).map((c) => ({
        globalCatalogId: c.id,
        canonicalSku: c.canonicalSku,
        fixedNameSw: c.fixedNameSw,
        fixedNameEn: c.fixedNameEn,
        category: c.categoryCode,
        categoryCode: c.categoryCode,
        imagekitCdnUrl: c.imagekitCdnUrl,
        staticImageUrl: c.staticImageUrl,
        defaultBaseUnitSw: 'Quanta (Robo 250 g / 250 mL)',
        defaultBaseUnitEn: 'Quanta (250 g / 250 mL Base)',
        clonedByStoresCount: Number(c.clonedByStoresCount ?? 0),
        updatedAtEat: c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '',
      }));
      setCatalog(mappedCatalog);
      setBackendOffline(false);

      if (!selectedCatalogId && mappedCatalog.length > 0) {
        setSelectedCatalogId(initialCatalogId || mappedCatalog[0].globalCatalogId);
      }
      if (!puSystemUnitId && unitRows.length > 0) {
        setPuSystemUnitId(unitRows[0].id);
      }
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setUnits([]);
        setCatalog([]);
      } else {
        setErrorBanner(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to load system units and pricing registry.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [initialCatalogId, puSystemUnitId, selectedCatalogId]);

  useEffect(() => {
    void loadBaseRegistry();
  }, [loadBaseRegistry]);

  useEffect(() => {
    if (initialCatalogId) {
      setSelectedCatalogId(initialCatalogId);
    }
  }, [initialCatalogId]);

  const loadProductPricingDetails = useCallback(async (catalogId: string) => {
    if (!catalogId) return;
    try {
      const res = await SokoApiClient.get<{
        globalCatalogId: string;
        units: BackendGlobalProductUnit[];
        standardPrices: BackendStandardPrice[];
      }>(`/marketplace/catalog/${catalogId}/standard-prices`);

      const loadedUnits = res.units || [];
      const loadedPrices = res.standardPrices || [];
      setProductUnits(loadedUnits);
      setStandardPrices(loadedPrices);

      const drafts: Record<
        string,
        { retailPriceTzs: string; wholesalePriceTzs: string; wholesaleMinQty: string }
      > = {};
      for (const u of loadedUnits) {
        const retail = loadedPrices.find(
          (p) => p.globalProductUnitId === u.id && p.profileType === 'RETAIL' && p.isActive
        );
        const wholesale = loadedPrices.find(
          (p) => p.globalProductUnitId === u.id && p.profileType === 'WHOLESALE' && p.isActive
        );
        drafts[u.id] = {
          retailPriceTzs: retail ? String(retail.standardPriceTzs) : '',
          wholesalePriceTzs: wholesale ? String(wholesale.standardPriceTzs) : '',
          wholesaleMinQty: wholesale ? String(wholesale.minQty) : u.isWholesaleUnit ? '1' : '5',
        };
      }
      setPriceDrafts(drafts);
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorBanner(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to load product units & standard prices.'
        );
      }
    }
  }, []);

  useEffect(() => {
    if (selectedCatalogId) {
      void loadProductPricingDetails(selectedCatalogId);
    }
  }, [selectedCatalogId, loadProductPricingDetails]);

  const handleToggleUnitActive = async (unit: BackendSystemUnit) => {
    setErrorBanner(null);
    const nextState = !unit.isActive;
    try {
      const updated = await SokoApiClient.patch<BackendSystemUnit>(`/admin/units/${unit.id}`, {
        isActive: nextState,
      });
      setUnits((prev) => prev.map((u) => (u.id === unit.id ? updated : u)));
      setBackendOffline(false);
      setStatusMessage(
        isSw
          ? `Kipimo "${unit.nameSw}" sasa ${nextState ? 'KIMEWASHWA' : 'KIMEZIMWA'}.`
          : `Unit "${unit.nameEn}" is now ${nextState ? 'ACTIVE' : 'INACTIVE'}.`
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setErrorBanner(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to toggle system unit status.'
        );
      }
    }
  };

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);
    if (!newUnitCode.trim() || !newNameSw.trim() || !newNameEn.trim() || !newAbbr.trim()) return;

    setIsSaving(true);
    try {
      const created = await SokoApiClient.post<BackendSystemUnit>('/admin/units', {
        unitCode: newUnitCode.trim().toUpperCase(),
        category: newCategory,
        nameSw: newNameSw.trim(),
        nameEn: newNameEn.trim(),
        abbreviation: newAbbr.trim(),
        allowFractional: newAllowsFractional,
        baseReferenceCode: newBaseRef.trim().toUpperCase() || undefined,
      });
      setUnits((prev) => [...prev, created]);
      setBackendOffline(false);
      setShowAddUnitModal(false);
      setNewUnitCode('');
      setNewNameSw('');
      setNewNameEn('');
      setNewAbbr('');
      setStatusMessage(
        isSw
          ? `Kipimo kipya "${created.nameSw}" [${created.unitCode}] kimesajiliwa kwenye PostgreSQL.`
          : `New system unit "${created.nameEn}" [${created.unitCode}] registered in PostgreSQL.`
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setShowAddUnitModal(false);
      } else {
        setErrorBanner(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to create system unit.'
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  const openNewProductUnit = () => {
    setEditingProductUnitId(null);
    setPuSystemUnitId(units.find((u) => u.isActive)?.id ?? '');
    setPuQuarterQuanta(100);
    setPuLabelSw('');
    setPuLabelEn('');
    setPuIsWholesale(true);
    setShowProductUnitModal(true);
  };

  const openEditProductUnit = (productUnit: BackendGlobalProductUnit) => {
    setEditingProductUnitId(productUnit.id);
    setPuSystemUnitId(productUnit.systemUnitId);
    setPuQuarterQuanta(productUnit.quarterQuantaPerUnit);
    setPuLabelSw(productUnit.displayLabelSw);
    setPuLabelEn(productUnit.displayLabelEn);
    setPuIsWholesale(productUnit.isWholesaleUnit);
    setShowProductUnitModal(true);
  };

  const handleDefineProductUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCatalogId || !puSystemUnitId) return;
    setErrorBanner(null);
    setIsSaving(true);
    try {
      const body = {
        systemUnitId: puSystemUnitId,
        quarterQuantaPerUnit: Math.max(1, Number(puQuarterQuanta)),
        displayLabelSw: puLabelSw.trim() || undefined,
        displayLabelEn: puLabelEn.trim() || undefined,
        isWholesaleUnit: puIsWholesale,
      };
      if (editingProductUnitId) {
        await SokoApiClient.patch(
          `/admin/marketplace/catalog/${selectedCatalogId}/units/${editingProductUnitId}`,
          body,
        );
      } else {
        await SokoApiClient.post(`/admin/marketplace/catalog/${selectedCatalogId}/units`, body);
      }
      setShowProductUnitModal(false);
      setEditingProductUnitId(null);
      setPuLabelSw('');
      setPuLabelEn('');
      await loadProductPricingDetails(selectedCatalogId);
      setStatusMessage(
        isSw
          ? 'Kipimo mahususi cha bidhaa kimehifadhiwa (Quarter-Quanta mapping).'
          : 'Product-specific unit conversion saved.'
      );
    } catch (err) {
      setErrorBanner(
        err instanceof SokoHttpError
          ? `HTTP ${err.status}: ${err.message}`
          : 'Failed to define product-specific unit.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublishStandardPrices = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCatalogId) return;
    setErrorBanner(null);

    const retailProfile = profiles.find((p) => p.profileType === 'RETAIL');
    const wholesaleProfile = profiles.find((p) => p.profileType === 'WHOLESALE');

    const pricesPayload: Array<{
      globalProductUnitId: string;
      pricingProfileId: string;
      profileType: 'RETAIL' | 'WHOLESALE';
      minQty: number;
      maxQty: number | null;
      standardPriceTzs: number;
    }> = [];

    for (const unit of productUnits) {
      const draft = priceDrafts[unit.id];
      if (!draft) continue;
      const retailVal = Number(draft.retailPriceTzs);
      const wholesaleVal = Number(draft.wholesalePriceTzs);
      const minQty = Math.max(1, Number(draft.wholesaleMinQty) || 1);

      if (retailVal > 0 && retailProfile) {
        pricesPayload.push({
          globalProductUnitId: unit.id,
          pricingProfileId: retailProfile.id,
          profileType: 'RETAIL',
          minQty: 1,
          maxQty: null,
          standardPriceTzs: Math.round(retailVal),
        });
      }
      if (wholesaleVal > 0 && wholesaleProfile) {
        pricesPayload.push({
          globalProductUnitId: unit.id,
          pricingProfileId: wholesaleProfile.id,
          profileType: 'WHOLESALE',
          minQty,
          maxQty: null,
          standardPriceTzs: Math.round(wholesaleVal),
        });
      }
    }

    if (pricesPayload.length === 0) {
      setErrorBanner(
        isSw
          ? 'Ingiza angalau bei moja ya Rejareja au Jumla (> 0 TZS) kabla ya kuchapisha.'
          : 'Enter at least one Retail or Wholesale price (> 0 TZS) before publishing.'
      );
      return;
    }

    setIsSaving(true);
    try {
      const res = await SokoApiClient.post<{
        canonicalSku: string;
        publishedCount: number;
      }>(`/admin/marketplace/catalog/${selectedCatalogId}/standard-prices`, {
        prices: pricesPayload,
      });

      await loadProductPricingDetails(selectedCatalogId);
      setStatusMessage(
        isSw
          ? `Bei sanifu ${res.publishedCount} za ${res.canonicalSku} zimechapishwa (toleo jipya bila kugusa bei binafsi za wafanyabiashara).`
          : `Published ${res.publishedCount} versioned standard prices for ${res.canonicalSku} without altering Merchant overrides.`
      );
    } catch (err) {
      setErrorBanner(
        err instanceof SokoHttpError
          ? `HTTP ${err.status}: ${err.message}`
          : 'Failed to publish standard prices.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const filteredUnits = units.filter((u) => {
    const matchesCat = categoryFilter === 'ALL' || u.category === categoryFilter;
    const q = searchUnit.trim().toLowerCase();
    const matchesSearch =
      q.length === 0 ||
      u.unitCode.toLowerCase().includes(q) ||
      u.nameSw.toLowerCase().includes(q) ||
      u.nameEn.toLowerCase().includes(q) ||
      u.abbreviation.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  const selectedCatalogItem = catalog.find((c) => c.globalCatalogId === selectedCatalogId);

  return (
    <div className="space-y-6">
      {backendOffline && (
        <BackendOfflineBanner
          locale={locale}
          onRetry={() => void loadBaseRegistry()}
          retrying={isLoading}
        />
      )}
      {errorBanner && (
        <div
          role="alert"
          className="border border-red-200 bg-red-50 rounded-lg p-3 flex items-center justify-between gap-3 text-xs font-semibold text-red-900"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-red-700 hover:text-red-950 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          className="border border-emerald-200 bg-emerald-50 rounded-lg p-3 flex items-center justify-between gap-3 text-xs font-semibold text-emerald-950"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{statusMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Telemetry Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-3 bg-white border border-slate-100 rounded-lg shadow-sm divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
        <div className="p-4 space-y-1">
          <div className="text-xs text-slate-500">
            {isSw ? 'Vipimo Rasmi vya Mfumo' : 'Canonical System Units'}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {units.length}
          </div>
          <div className="text-[11px] font-mono text-emerald-700">
            WEIGHT · VOLUME · PACKAGING
          </div>
        </div>
        <div className="p-4 space-y-1">
          <div className="text-xs text-slate-500">
            {isSw ? 'Kipimo cha Msingi (Base Unit)' : 'Base Discrete Quanta'}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600">
            1 Q = 250g / 250mL
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            Per-Product Unit Conversion Factor
          </div>
        </div>
        <div className="p-4 space-y-1">
          <div className="text-xs text-slate-500">
            {isSw ? 'Bei Sanifu Zinazotumika' : 'Active Product Standard Prices'}
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {standardPrices.length}
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            Versioned · Zero Override Interference
          </div>
        </div>
      </section>

      {/* SECTION 1: SYSTEM UNIT REGISTRY */}
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {isSw ? 'Sajili Kuu ya Vipimo (System Units Registry)' : 'Canonical System Units Registry'}
              </h2>
              <p className="text-xs text-slate-500">
                {isSw
                  ? 'Vipimo vya mfumo mzima kwa ajili ya uzito, ujazo, na vifungashio vya jadi (sado, debe, gunia).'
                  : 'Platform-wide canonical units for metric weights, volumes, and traditional packaging.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadBaseRegistry()}
              disabled={isLoading}
              className="px-2.5 py-1.5 min-h-[36px] text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchUnit}
                onChange={(e) => setSearchUnit(e.target.value)}
                placeholder={isSw ? 'Tafuta kipimo...' : 'Filter units...'}
                className="pl-8 pr-3 py-1.5 min-h-[36px] text-xs rounded-lg border border-slate-200 bg-white text-slate-900"
              />
            </div>

            <div className="sk-scroll-x items-center gap-1 pb-1">
              {(
                [
                  { key: 'ALL', sw: 'Zote', en: 'All' },
                  { key: 'WEIGHT', sw: 'Uzito', en: 'Weight' },
                  { key: 'VOLUME', sw: 'Ujazo', en: 'Volume' },
                  { key: 'PACKAGING', sw: 'Vifungashio', en: 'Packaging' },
                ] as const
              ).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setCategoryFilter(f.key)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                    categoryFilter === f.key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {isSw ? f.sw : f.en}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowAddUnitModal(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? 'Ongeza Kipimo' : 'Add Unit'}</span>
            </button>
          </div>
        </div>

        {filteredUnits.length === 0 ? (
          <EmptyStateCard
            locale={locale}
            titleSw="Hakuna vipimo vya mfumo"
            titleEn="No system units found"
            descriptionSw="Sajili vipimo vya mfumo au hakikisha PostgreSQL ina rekodi."
            descriptionEn="Register a canonical system unit in PostgreSQL."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3">{isSw ? 'Msimbo & Kipimo' : 'Code & Unit'}</th>
                  <th className="py-2.5 px-3">{isSw ? 'Kategoria' : 'Category'}</th>
                  <th className="py-2.5 px-3">{isSw ? 'Kifupi & Msingi' : 'Abbr & Base Ref'}</th>
                  <th className="py-2.5 px-3">{isSw ? 'Vipande vya Sehemu' : 'Fractional'}</th>
                  <th className="py-2.5 px-3 text-right">{isSw ? 'Hali' : 'Status'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUnits.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">
                        {isSw ? u.nameSw : u.nameEn}
                      </div>
                      <div className="font-mono text-emerald-700 font-bold text-[11px]">
                        {u.unitCode}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">{u.category}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-900">
                      [{u.abbreviation}] · {u.baseReferenceCode ?? 'QUANTA'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {u.allowFractional ? (
                        <span className="text-emerald-700 font-medium">
                          {isSw ? 'Ndiyo (Inaruhusiwa)' : 'Yes (Allowed)'}
                        </span>
                      ) : (
                        <span className="text-slate-400">
                          {isSw ? 'Hapana (Kamili Pekee)' : 'Discrete Only'}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => void handleToggleUnitActive(u)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border ${
                          u.isActive
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-slate-50 text-slate-500'
                        }`}
                      >
                        <span>{u.isActive ? (isSw ? 'Hai' : 'Active') : (isSw ? 'Imezimwa' : 'Inactive')}</span>
                        {u.isActive ? (
                          <ToggleRight className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <ToggleLeft className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* SECTION 2: PRODUCT-SPECIFIC UNITS & VERSIONED STANDARD PRICING */}
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {isSw
                  ? 'Vipimo vya Bidhaa & Bei Sanifu za Jukwaa'
                  : 'Product-Specific Units & Versioned Standard Pricing'}
              </h2>
              <p className="text-xs text-slate-500">
                {isSw
                  ? 'Kila bidhaa ina ulinganifu wake (mf. Gunia la 25KG vs 50KG) na bei sanifu za Rejareja & Jumla.'
                  : 'Configure per-product unit Quarter-Quanta factors and publish versioned Retail & Wholesale prices.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-slate-700">
              {isSw ? 'Chagua Bidhaa:' : 'Select SKU:'}
            </label>
            <select
              value={selectedCatalogId}
              onChange={(e) => setSelectedCatalogId(e.target.value)}
              className="px-3 py-1.5 min-h-[36px] text-xs font-mono font-semibold rounded-lg border border-slate-200 bg-white text-slate-900"
            >
              {catalog.map((item) => (
                <option key={item.globalCatalogId} value={item.globalCatalogId}>
                  {item.canonicalSku} — {isSw ? item.fixedNameSw : item.fixedNameEn}
                </option>
              ))}
            </select>
            {selectedCatalogId && !backendOffline && (
              <button
                type="button"
                onClick={openNewProductUnit}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 cursor-pointer"
              >
                <Boxes className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span>{isSw ? '+ Kipimo cha Bidhaa' : '+ Define Product Unit'}</span>
              </button>
            )}
          </div>
        </div>

        {selectedCatalogItem && (
          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-900">
              {selectedCatalogItem.canonicalSku} ·{' '}
              {isSw ? selectedCatalogItem.fixedNameSw : selectedCatalogItem.fixedNameEn}
            </span>
            <span className="font-mono text-[11px] text-emerald-700">
              {productUnits.length} {isSw ? 'vipimo vilivyofungwa' : 'configured product units'}
            </span>
          </div>
        )}

        {selectedCatalogItem && !backendOffline && (
          <div className="border border-slate-200 rounded-lg p-3 bg-white">
            <PricingTemplateAttachmentEditor
              locale={locale}
              globalCatalogId={selectedCatalogId}
              compact
            />
          </div>
        )}

        <form onSubmit={handlePublishStandardPrices} className="space-y-4">
          {productUnits.length === 0 ? (
            <EmptyStateCard
              locale={locale}
              titleSw="Hakuna vipimo vya bidhaa vilivyofungwa"
              titleEn="No product-specific units defined"
              descriptionSw="Bofya '+ Kipimo cha Bidhaa' kufafanua kipimo na bei sanifu kwenye PostgreSQL."
              descriptionEn="Click '+ Define Product Unit' to configure unit pricing in PostgreSQL."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">{isSw ? 'Kipimo cha Bidhaa' : 'Product Unit'}</th>
                    <th className="py-2.5 px-3">{isSw ? 'Ulinganifu' : 'Conversion'}</th>
                    <th className="py-2.5 px-3">{isSw ? 'Bei Sanifu Rejareja (TZS)' : 'Std Retail (TZS)'}</th>
                    <th className="py-2.5 px-3">{isSw ? 'Bei Sanifu Jumla (TZS)' : 'Std Wholesale (TZS)'}</th>
                    <th className="py-2.5 px-3">{isSw ? 'Min Qty (Jumla)' : 'Wholesale Min Qty'}</th>
                    <th className="py-2.5 px-3 text-right">{isSw ? 'Toleo' : 'Version'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productUnits.map((u) => {
                    const draft = priceDrafts[u.id] ?? {
                      retailPriceTzs: '',
                      wholesalePriceTzs: '',
                      wholesaleMinQty: '1',
                    };
                    const activeRet = standardPrices.find(
                      (p) =>
                        p.globalProductUnitId === u.id && p.profileType === 'RETAIL' && p.isActive
                    );
                    const activeWh = standardPrices.find(
                      (p) =>
                        p.globalProductUnitId === u.id &&
                        p.profileType === 'WHOLESALE' &&
                        p.isActive
                    );

                    return (
                      <tr key={u.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">
                            {isSw ? u.displayLabelSw : u.displayLabelEn}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {u.systemUnit.unitCode} [{u.systemUnit.abbreviation}]
                            {u.isWholesaleUnit ? ' · Wholesale Unit' : ''}
                          </div>
                          <button
                            type="button"
                            onClick={() => openEditProductUnit(u)}
                            className="mt-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 underline-offset-2 hover:underline cursor-pointer"
                          >
                            {isSw ? 'Hariri kipimo' : 'Edit unit'}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-emerald-700 tabular-nums">
                          {u.quarterQuantaPerUnit} Q (
                          {formatQuantaMeasurement(
                            u.quarterQuantaPerUnit,
                            u.systemUnit.category,
                            isSw ? 'sw' : 'en',
                          )}
                          )
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            min={0}
                            value={draft.retailPriceTzs}
                            onChange={(e) =>
                              setPriceDrafts((prev) => ({
                                ...prev,
                                [u.id]: { ...draft, retailPriceTzs: e.target.value },
                              }))
                            }
                            placeholder={activeRet ? String(activeRet.standardPriceTzs) : '0'}
                            className="w-32 px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            min={0}
                            value={draft.wholesalePriceTzs}
                            onChange={(e) =>
                              setPriceDrafts((prev) => ({
                                ...prev,
                                [u.id]: { ...draft, wholesalePriceTzs: e.target.value },
                              }))
                            }
                            placeholder={activeWh ? String(activeWh.standardPriceTzs) : '0'}
                            className="w-32 px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            min={1}
                            value={draft.wholesaleMinQty}
                            onChange={(e) =>
                              setPriceDrafts((prev) => ({
                                ...prev,
                                [u.id]: { ...draft, wholesaleMinQty: e.target.value },
                              }))
                            }
                            className="w-20 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white text-slate-900"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-[11px] text-slate-600">
                          {activeRet ? `R:v${activeRet.version}` : 'R:-'} ·{' '}
                          {activeWh ? `W:v${activeWh.version}` : 'W:-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {productUnits.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="text-xs text-slate-500">
                {isSw
                  ? 'Kuchapisha kunazalisha toleo jipya bila kubadilisha bei za zamani wala marekebisho ya wafanyabiashara.'
                  : 'Publishing creates a new active version cleanly without modifying Merchant overrides.'}
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isSw ? 'Chapisha Bei Sanifu' : 'Publish Standard Prices'}</span>
              </button>
            </div>
          )}
        </form>
      </section>

      {/* MODAL: ADD CANONICAL UNIT */}
      {showAddUnitModal && (
        <div
          className="sk-dialog-overlay backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="sk-dialog-panel">
            <div className="shrink-0 px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">
                {isSw ? 'Sajili Kipimo Kipya cha Mfumo' : 'Register New System Unit'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddUnitModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUnit} className="sk-dialog-body p-5 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Unit Code</label>
                  <input
                    type="text"
                    value={newUnitCode}
                    onChange={(e) => setNewUnitCode(e.target.value)}
                    placeholder="KIBABA"
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono uppercase text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Kategoria' : 'Category'}
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) =>
                      setNewCategory(e.target.value as 'WEIGHT' | 'VOLUME' | 'PACKAGING')
                    }
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900 bg-white"
                  >
                    <option value="WEIGHT">WEIGHT</option>
                    <option value="VOLUME">VOLUME</option>
                    <option value="PACKAGING">PACKAGING</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Jina (SW)' : 'Name (Swahili)'}
                  </label>
                  <input
                    type="text"
                    value={newNameSw}
                    onChange={(e) => setNewNameSw(e.target.value)}
                    placeholder="Kibaba"
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Jina (EN)' : 'Name (English)'}
                  </label>
                  <input
                    type="text"
                    value={newNameEn}
                    onChange={(e) => setNewNameEn(e.target.value)}
                    placeholder="Kibaba Measure"
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Kifupi (Abbreviation)' : 'Abbreviation'}
                  </label>
                  <input
                    type="text"
                    value={newAbbr}
                    onChange={(e) => setNewAbbr(e.target.value)}
                    placeholder="kibaba"
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Base Reference</label>
                  <input
                    type="text"
                    value={newBaseRef}
                    onChange={(e) => setNewBaseRef(e.target.value)}
                    placeholder="QUANTA_250G"
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={newAllowsFractional}
                    onChange={(e) => setNewAllowsFractional(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>
                    {isSw ? 'Inaruhusu namba za sehemu (Decimals)' : 'Allows fractional quantities'}
                  </span>
                </label>
              </div>

              <div className="shrink-0 sk-safe-bottom flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddUnitModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  {isSw ? 'Ghairi' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {isSw ? 'Hifadhi Kipimo' : 'Commit Unit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DEFINE PRODUCT-SPECIFIC UNIT */}
      {showProductUnitModal && (
        <div
          className="sk-dialog-overlay backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="sk-dialog-panel">
            <div className="shrink-0 px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">
                {editingProductUnitId
                  ? isSw
                    ? 'Hariri Kipimo Kwenye Bidhaa'
                    : 'Edit Product-Specific Unit'
                  : isSw
                    ? 'Funga Kipimo Kwenye Bidhaa'
                    : 'Define Product-Specific Unit'}
              </h3>
              <button
                type="button"
                onClick={() => setShowProductUnitModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-900 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDefineProductUnit} className="sk-dialog-body p-5 space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Kipimo cha Mfumo' : 'Canonical System Unit'}
                </label>
                <select
                  value={puSystemUnitId}
                  onChange={(e) => setPuSystemUnitId(e.target.value)}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900 bg-white"
                  required
                >
                  {units
                    .filter((u) => u.isActive)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unitCode} — {isSw ? u.nameSw : u.nameEn}
                      </option>
                    ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw
                    ? 'Idadi ya Quarter-Quanta (1 Q = 250g au 250mL; Gunia 50KG = 200 Q)'
                    : 'Quarter-Quanta Factor (4 Q = 1 KG au 1 L; 25 KG Sack = 100 Q)'}
                </label>
                <input
                  type="number"
                  min={1}
                  value={puQuarterQuanta}
                  onChange={(e) => setPuQuarterQuanta(Number(e.target.value))}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Lebo (SW)' : 'Display Label (SW)'}
                  </label>
                  <input
                    type="text"
                    value={puLabelSw}
                    onChange={(e) => setPuLabelSw(e.target.value)}
                    placeholder="Gunia la 25 KG"
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Lebo (EN)' : 'Display Label (EN)'}
                  </label>
                  <input
                    type="text"
                    value={puLabelEn}
                    onChange={(e) => setPuLabelEn(e.target.value)}
                    placeholder="25 KG Sack"
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 pt-1">
                <input
                  type="checkbox"
                  checked={puIsWholesale}
                  onChange={(e) => setPuIsWholesale(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>{isSw ? 'Kipimo cha Jumla (Wholesale Unit)' : 'Wholesale Packaging Unit'}</span>
              </label>

              <div className="shrink-0 sk-safe-bottom flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowProductUnitModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  {isSw ? 'Ghairi' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {isSw ? 'Hifadhi Kipimo cha Bidhaa' : 'Save Product Unit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
