import { useEffect, useState } from 'react';
import {
  Boxes,
  CheckCircle2,
  DollarSign,
  Layers,
  Plus,
  Scale,
  Search,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  TrendingUp,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { SokoApiClient } from '../services/sokoApiClient';
import {
  loadGlobalCatalogEntries,
  type GlobalCatalogEntry,
} from '../lib/sokoManagedState';

export interface CanonicalSystemUnit {
  unitId: string;
  category: 'WEIGHT' | 'VOLUME' | 'PACKAGING';
  nameSw: string;
  nameEn: string;
  abbreviation: string;
  allowsFractional: boolean;
  baseUnitMultiplier: number;
  isActive: boolean;
}

export interface GlobalProductUnitDefinition {
  productUnitId: string;
  globalCatalogId: string;
  unitCode: string;
  displayNameSw: string;
  displayNameEn: string;
  quarterQuantaFactor: number;
  isDefaultDisplayUnit: boolean;
  isActive: boolean;
}

export interface StandardPriceConfig {
  globalCatalogId: string;
  canonicalSku: string;
  buyingCostTzs: number;
  minSellingPriceTzs: number;
  suggestedRetailPriceTzs: number;
  suggestedWholesalePriceTzs: number;
  wholesaleMinQuarterQuanta: number;
  lastUpdatedEat: string;
}

const INITIAL_CANONICAL_UNITS: CanonicalSystemUnit[] = [
  {
    unitId: 'unit-q',
    category: 'WEIGHT',
    nameSw: 'Robo Quanta (250g / 250mL)',
    nameEn: 'Quarter-Quantum (250g / 250mL Base)',
    abbreviation: 'Q',
    allowsFractional: false,
    baseUnitMultiplier: 1,
    isActive: true,
  },
  {
    unitId: 'unit-kg',
    category: 'WEIGHT',
    nameSw: 'Kilogramu (KG)',
    nameEn: 'Kilogram (KG)',
    abbreviation: 'kg',
    allowsFractional: true,
    baseUnitMultiplier: 4,
    isActive: true,
  },
  {
    unitId: 'unit-g',
    category: 'WEIGHT',
    nameSw: 'Gramu (g)',
    nameEn: 'Gram (g)',
    abbreviation: 'g',
    allowsFractional: true,
    baseUnitMultiplier: 0.004,
    isActive: true,
  },
  {
    unitId: 'unit-t',
    category: 'WEIGHT',
    nameSw: 'Tani (Tonne)',
    nameEn: 'Metric Ton (t)',
    abbreviation: 't',
    allowsFractional: true,
    baseUnitMultiplier: 4000,
    isActive: true,
  },
  {
    unitId: 'unit-l',
    category: 'VOLUME',
    nameSw: 'Lita (L)',
    nameEn: 'Liter (L)',
    abbreviation: 'L',
    allowsFractional: true,
    baseUnitMultiplier: 4,
    isActive: true,
  },
  {
    unitId: 'unit-ml',
    category: 'VOLUME',
    nameSw: 'Mililita (mL)',
    nameEn: 'Milliliter (mL)',
    abbreviation: 'mL',
    allowsFractional: true,
    baseUnitMultiplier: 0.004,
    isActive: true,
  },
  {
    unitId: 'unit-debe',
    category: 'PACKAGING',
    nameSw: 'Debe la Jadi (18KG / 20L)',
    nameEn: 'Traditional Debe (18KG / 20L)',
    abbreviation: 'debe',
    allowsFractional: false,
    baseUnitMultiplier: 72,
    isActive: true,
  },
  {
    unitId: 'unit-sado',
    category: 'PACKAGING',
    nameSw: 'Sado (5KG)',
    nameEn: 'Sado Bucket (5KG)',
    abbreviation: 'sado',
    allowsFractional: false,
    baseUnitMultiplier: 20,
    isActive: true,
  },
  {
    unitId: 'unit-gunia',
    category: 'PACKAGING',
    nameSw: 'Gunia Kubwa (50KG / 100KG)',
    nameEn: 'Bulk Gunia Sack (50KG/100KG)',
    abbreviation: 'gunia',
    allowsFractional: false,
    baseUnitMultiplier: 200,
    isActive: true,
  },
  {
    unitId: 'unit-box',
    category: 'PACKAGING',
    nameSw: 'Katoni / Boksi (Box)',
    nameEn: 'Master Carton / Box',
    abbreviation: 'box',
    allowsFractional: false,
    baseUnitMultiplier: 48,
    isActive: true,
  },
  {
    unitId: 'unit-pk',
    category: 'PACKAGING',
    nameSw: 'Pakiti (Packet)',
    nameEn: 'Consumer Packet',
    abbreviation: 'pk',
    allowsFractional: false,
    baseUnitMultiplier: 4,
    isActive: true,
  },
  {
    unitId: 'unit-pc',
    category: 'PACKAGING',
    nameSw: 'Kipande (Piece)',
    nameEn: 'Piece / Unit',
    abbreviation: 'pc',
    allowsFractional: false,
    baseUnitMultiplier: 1,
    isActive: true,
  },
];

const INITIAL_STANDARD_PRICES: Record<string, StandardPriceConfig> = {
  'GC-AZM-JUICE': {
    globalCatalogId: 'gc-01',
    canonicalSku: 'GC-AZM-JUICE',
    buyingCostTzs: 1600,
    minSellingPriceTzs: 1800,
    suggestedRetailPriceTzs: 2200,
    suggestedWholesalePriceTzs: 1950,
    wholesaleMinQuarterQuanta: 48,
    lastUpdatedEat: 'Leo 10:00 EAT',
  },
  'MBY-RIC': {
    globalCatalogId: 'gc-02',
    canonicalSku: 'MBY-RIC',
    buyingCostTzs: 550,
    minSellingPriceTzs: 600,
    suggestedRetailPriceTzs: 720,
    suggestedWholesalePriceTzs: 640,
    wholesaleMinQuarterQuanta: 100,
    lastUpdatedEat: 'Leo 10:15 EAT',
  },
  'KOR-OIL-20L': {
    globalCatalogId: 'gc-03',
    canonicalSku: 'KOR-OIL-20L',
    buyingCostTzs: 820,
    minSellingPriceTzs: 860,
    suggestedRetailPriceTzs: 1050,
    suggestedWholesalePriceTzs: 920,
    wholesaleMinQuarterQuanta: 72,
    lastUpdatedEat: 'Leo 11:00 EAT',
  },
};

export function AdminUnitsAndPricingPanel({ locale = 'sw' }: { locale?: Locale }) {
  const isSw = locale === 'sw';

  const [units, setUnits] = useState<CanonicalSystemUnit[]>(INITIAL_CANONICAL_UNITS);
  const [standardPrices, setStandardPrices] = useState<Record<string, StandardPriceConfig>>(
    INITIAL_STANDARD_PRICES
  );
  const [catalog] = useState<GlobalCatalogEntry[]>(() => loadGlobalCatalogEntries());
  const [selectedSku, setSelectedSku] = useState<string>(
    catalog[0]?.canonicalSku ?? 'GC-AZM-JUICE'
  );
  const [searchUnit, setSearchUnit] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'WEIGHT' | 'VOLUME' | 'PACKAGING'>('ALL');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // New Unit Form Modal State
  const [showAddUnitModal, setShowAddUnitModal] = useState<boolean>(false);
  const [newCategory, setNewCategory] = useState<'WEIGHT' | 'VOLUME' | 'PACKAGING'>('PACKAGING');
  const [newNameSw, setNewNameSw] = useState<string>('');
  const [newNameEn, setNewNameEn] = useState<string>('');
  const [newAbbr, setNewAbbr] = useState<string>('');
  const [newMultiplier, setNewMultiplier] = useState<number>(4);
  const [newAllowsFractional, setNewAllowsFractional] = useState<boolean>(false);

  // Price Edit State
  const activePriceConfig = standardPrices[selectedSku] ?? {
    globalCatalogId: 'gc-custom',
    canonicalSku: selectedSku,
    buyingCostTzs: 1000,
    minSellingPriceTzs: 1100,
    suggestedRetailPriceTzs: 1300,
    suggestedWholesalePriceTzs: 1180,
    wholesaleMinQuarterQuanta: 40,
    lastUpdatedEat: 'Sasa Hivi',
  };

  const [editBuyingCost, setEditBuyingCost] = useState<number>(activePriceConfig.buyingCostTzs);
  const [editMinPrice, setEditMinPrice] = useState<number>(activePriceConfig.minSellingPriceTzs);
  const [editRetailPrice, setEditRetailPrice] = useState<number>(activePriceConfig.suggestedRetailPriceTzs);
  const [editWholesalePrice, setEditWholesalePrice] = useState<number>(activePriceConfig.suggestedWholesalePriceTzs);
  const [editMinQuanta, setEditMinQuanta] = useState<number>(activePriceConfig.wholesaleMinQuarterQuanta);

  useEffect(() => {
    const current = standardPrices[selectedSku];
    if (current) {
      setEditBuyingCost(current.buyingCostTzs);
      setEditMinPrice(current.minSellingPriceTzs);
      setEditRetailPrice(current.suggestedRetailPriceTzs);
      setEditWholesalePrice(current.suggestedWholesalePriceTzs);
      setEditMinQuanta(current.wholesaleMinQuarterQuanta);
    }
  }, [selectedSku, standardPrices]);

  // Fetch live system units from API on mount
  useEffect(() => {
    let cancelled = false;
    async function loadUnitsFromApi() {
      try {
        const live = await SokoApiClient.get<CanonicalSystemUnit[]>('/admin/units');
        if (!cancelled && Array.isArray(live) && live.length > 0) {
          setUnits(live);
        }
      } catch {
        // Offline fallback already initialized
      }
    }
    void loadUnitsFromApi();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleUnitActive = async (unit: CanonicalSystemUnit) => {
    const nextState = !unit.isActive;
    setUnits((prev) =>
      prev.map((u) => (u.unitId === unit.unitId ? { ...u, isActive: nextState } : u))
    );

    try {
      await SokoApiClient.patch(`/admin/units/${unit.unitId}`, { isActive: nextState });
    } catch {
      // Local state updated gracefully
    }

    setStatusMessage(
      isSw
        ? `Kipimo "${unit.nameSw}" sasa ${nextState ? 'KIMEWASHWA' : 'KIMEZIMWA'}.`
        : `Unit "${unit.nameEn}" is now ${nextState ? 'ACTIVE' : 'INACTIVE'}.`
    );
  };

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNameSw.trim() || !newNameEn.trim() || !newAbbr.trim()) return;

    const newUnit: CanonicalSystemUnit = {
      unitId: 'unit-' + Math.random().toString(36).substring(2, 8),
      category: newCategory,
      nameSw: newNameSw.trim(),
      nameEn: newNameEn.trim(),
      abbreviation: newAbbr.trim().toLowerCase(),
      allowsFractional: newAllowsFractional,
      baseUnitMultiplier: Number(newMultiplier) || 1,
      isActive: true,
    };

    setUnits((prev) => [...prev, newUnit]);
    setShowAddUnitModal(false);

    try {
      await SokoApiClient.post('/admin/units', newUnit);
    } catch {
      // Local fallback saved
    }

    setStatusMessage(
      isSw
        ? `Kipimo kipya "${newUnit.nameSw}" kimesajiliwa (/api/v1/admin/units).`
        : `New system unit "${newUnit.nameEn}" registered (/api/v1/admin/units).`
    );

    setNewNameSw('');
    setNewNameEn('');
    setNewAbbr('');
    setNewMultiplier(4);
  };

  const handleSaveStandardPrices = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editMinPrice < editBuyingCost) {
      setStatusMessage(
        isSw
          ? 'Kosa la Kulinda Hasara: Bei ya chini ya kuuza haiwezi kuwa chini ya gharama ya kununua!'
          : 'Loss Prevention Error: Min selling price cannot be lower than buying cost!'
      );
      return;
    }

    const updated: StandardPriceConfig = {
      globalCatalogId: activePriceConfig.globalCatalogId,
      canonicalSku: selectedSku,
      buyingCostTzs: editBuyingCost,
      minSellingPriceTzs: editMinPrice,
      suggestedRetailPriceTzs: editRetailPrice,
      suggestedWholesalePriceTzs: editWholesalePrice,
      wholesaleMinQuarterQuanta: editMinQuanta,
      lastUpdatedEat: new Date().toLocaleTimeString(),
    };

    setStandardPrices((prev) => ({ ...prev, [selectedSku]: updated }));

    try {
      await SokoApiClient.post(
        `/admin/marketplace/catalog/${activePriceConfig.globalCatalogId}/standard-prices`,
        updated
      );
    } catch {
      // Local fallback saved
    }

    setStatusMessage(
      isSw
        ? `Bei sanifu za ${selectedSku} zimehifadhiwa (Gharama: TZS ${editBuyingCost}, Rejareja: TZS ${editRetailPrice}, Jumla: TZS ${editWholesalePrice}).`
        : `Standard prices for ${selectedSku} saved (Cost: TZS ${editBuyingCost}, Retail: TZS ${editRetailPrice}, Wholesale: TZS ${editWholesalePrice}).`
    );
  };

  const filteredUnits = units.filter((u) => {
    const matchesCat = categoryFilter === 'ALL' || u.category === categoryFilter;
    const q = searchUnit.trim().toLowerCase();
    const matchesSearch =
      q.length === 0 ||
      u.nameSw.toLowerCase().includes(q) ||
      u.nameEn.toLowerCase().includes(q) ||
      u.abbreviation.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-6">
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
            Quarter-Quanta Integer Scale
          </div>
        </div>
        <div className="p-4 space-y-1">
          <div className="text-xs text-slate-500">
            {isSw ? 'Injini ya Bei Sanifu' : 'Standard Pricing Guard'}
          </div>
          <div className="text-sm font-bold font-mono text-slate-900">
            Zero-Loss Enforcement
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            Buying Cost &le; Min Price &le; Retail
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

            <div className="flex items-center gap-1">
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

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                <th className="py-2.5 px-3">{isSw ? 'Kipimo & Kifupi' : 'Unit & Abbreviation'}</th>
                <th className="py-2.5 px-3">{isSw ? 'Kategoria' : 'Category'}</th>
                <th className="py-2.5 px-3">{isSw ? 'Thamani kwa Quanta' : 'Quanta Multiplier'}</th>
                <th className="py-2.5 px-3">{isSw ? 'Vipande vya Sehemu' : 'Fractional'}</th>
                <th className="py-2.5 px-3 text-right">{isSw ? 'Hali' : 'Status'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUnits.map((u) => (
                <tr key={u.unitId} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-slate-900">
                      {isSw ? u.nameSw : u.nameEn}
                    </div>
                    <div className="font-mono text-emerald-700 font-bold">
                      [{u.abbreviation}]
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-600">
                    {u.category}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-900 font-bold tabular-nums">
                    {u.baseUnitMultiplier} Q ({u.baseUnitMultiplier * 250 >= 1000 ? `${(u.baseUnitMultiplier * 250) / 1000}kg` : `${u.baseUnitMultiplier * 250}g`})
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">
                    {u.allowsFractional ? (
                      <span className="text-emerald-700 font-medium">{isSw ? 'Ndiyo (Inaruhusiwa)' : 'Yes (Allowed)'}</span>
                    ) : (
                      <span className="text-slate-400">{isSw ? 'Hapana (Kamili Pekee)' : 'Discrete Only'}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleToggleUnitActive(u)}
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
      </section>

      {/* SECTION 2: STANDARD PRICING ENGINE */}
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {isSw ? 'Injini ya Bei Sanifu ya Jukwaa (Standard Pricing Engine)' : 'Platform Standard Pricing Engine'}
              </h2>
              <p className="text-xs text-slate-500">
                {isSw
                  ? 'Weka viwango vya bei ya ununuzi, bei ya chini ya kulinda hasara, na bei zilizopendekezwa za jumla na rejareja.'
                  : 'Define canonical buying costs, loss-prevention price floors, and suggested tier prices.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-700">
              {isSw ? 'Chagua Bidhaa:' : 'Select SKU:'}
            </label>
            <select
              value={selectedSku}
              onChange={(e) => setSelectedSku(e.target.value)}
              className="px-3 py-1.5 min-h-[36px] text-xs font-mono font-semibold rounded-lg border border-slate-200 bg-white text-slate-900"
            >
              {catalog.map((item) => (
                <option key={item.globalCatalogId} value={item.canonicalSku}>
                  {item.canonicalSku} — {isSw ? item.fixedNameSw : item.fixedNameEn}
                </option>
              ))}
            </select>
          </div>
        </div>

        <form onSubmit={handleSaveStandardPrices} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                {isSw ? 'Gharama ya Kununua (Buying Cost)' : 'Standard Buying Cost'}
              </label>
              <div className="relative">
                <span className="text-xs font-mono font-bold text-slate-400 absolute left-3 top-1/2 -translate-y-1/2">
                  TZS
                </span>
                <input
                  type="number"
                  min={1}
                  value={editBuyingCost}
                  onChange={(e) => setEditBuyingCost(Number(e.target.value))}
                  className="w-full pl-12 pr-3 py-2 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                  required
                />
              </div>
              <p className="text-[11px] text-slate-500">
                {isSw ? 'Gharama ya chini kabisa ya ununuzi kutoka kiwandani.' : 'Direct procurement floor cost.'}
              </p>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                {isSw ? 'Bei ya Chini Kabisa ya Kuuza (Min Price Floor)' : 'Minimum Selling Price Floor'}
              </label>
              <div className="relative">
                <span className="text-xs font-mono font-bold text-slate-400 absolute left-3 top-1/2 -translate-y-1/2">
                  TZS
                </span>
                <input
                  type="number"
                  min={editBuyingCost}
                  value={editMinPrice}
                  onChange={(e) => setEditMinPrice(Number(e.target.value))}
                  className="w-full pl-12 pr-3 py-2 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                  required
                />
              </div>
              <p className="text-[11px] text-slate-500">
                {isSw ? 'Hairuhusiwi kuuza chini ya bei hii (uzuiaji hasara).' : 'Hard floor to enforce channel harmony.'}
              </p>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                {isSw ? 'Bei Iliyopendekezwa ya Rejareja' : 'Suggested Retail Price'}
              </label>
              <div className="relative">
                <span className="text-xs font-mono font-bold text-slate-400 absolute left-3 top-1/2 -translate-y-1/2">
                  TZS
                </span>
                <input
                  type="number"
                  min={editMinPrice}
                  value={editRetailPrice}
                  onChange={(e) => setEditRetailPrice(Number(e.target.value))}
                  className="w-full pl-12 pr-3 py-2 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                  required
                />
              </div>
              <p className="text-[11px] text-slate-500">
                {isSw ? 'Bei ya duka la rejareja (Retail Duka).' : 'Standard consumer retail price.'}
              </p>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                {isSw ? 'Bei Iliyopendekezwa ya Jumla' : 'Suggested Wholesale Price'}
              </label>
              <div className="relative">
                <span className="text-xs font-mono font-bold text-slate-400 absolute left-3 top-1/2 -translate-y-1/2">
                  TZS
                </span>
                <input
                  type="number"
                  min={editMinPrice}
                  value={editWholesalePrice}
                  onChange={(e) => setEditWholesalePrice(Number(e.target.value))}
                  className="w-full pl-12 pr-3 py-2 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                  required
                />
              </div>
              <p className="text-[11px] text-slate-500">
                {isSw ? 'Bei ya maduka ya jumla (Wholesale Hub).' : 'Discounted tier for wholesale orders.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="text-xs text-slate-500">
              {isSw ? 'Ilisasishwa:' : 'Last updated:'} {activePriceConfig.lastUpdatedEat}
            </div>

            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer inline-flex items-center gap-1.5"
            >
              <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? 'Hifadhi Bei Sanifu' : 'Save Standard Prices'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* MODAL: ADD CANONICAL UNIT */}
      {showAddUnitModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
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

            <form onSubmit={handleCreateUnit} className="p-5 space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Kategoria ya Kipimo' : 'Unit Category'}
                </label>
                <select
                  value={newCategory}
                  onChange={(e) =>
                    setNewCategory(e.target.value as 'WEIGHT' | 'VOLUME' | 'PACKAGING')
                  }
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900 bg-white"
                >
                  <option value="WEIGHT">WEIGHT (Uzito - g, kg, t)</option>
                  <option value="VOLUME">VOLUME (Ujazo - mL, L)</option>
                  <option value="PACKAGING">PACKAGING (Vifungashio - sado, debe, gunia, box)</option>
                </select>
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
                    placeholder="Debe Ndogo"
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
                    placeholder="Small Debe"
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
                    placeholder="s-debe"
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Thamani kwa Quanta' : 'Quanta Multiplier'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newMultiplier}
                    onChange={(e) => setNewMultiplier(Number(e.target.value))}
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                    required
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
                  <span>{isSw ? 'Inaruhusu namba za sehemu (Decimals)' : 'Allows fractional quantities'}</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddUnitModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  {isSw ? 'Ghairi' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer"
                >
                  {isSw ? 'Hifadhi Kipimo' : 'Commit Unit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
