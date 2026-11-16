import { useEffect, useState } from 'react';
import { Store, ShieldAlert, ArrowRightLeft, Layers } from 'lucide-react';
import { useHybridMode } from '../context/HybridModeContext';
import type { Locale } from '../data/i18n';
import {
  formatBusinessTierLabel,
  formatUnitTypeLabel,
} from '../lib/sokoManagedState';

export type PackagingUnitCode =
  | 'SACK_50KG'
  | 'SACK_25KG'
  | 'CARTON'
  | 'QUARTER_KILO_LITRE'
  | 'HALF_KILO_LITRE'
  | 'THREE_QUARTER_KILO'
  | 'SINGLE_KILO_LITRE';

interface CatalogTierItem {
  id: string;
  sku: string;
  nameSw: string;
  nameEn: string;
  channel: 'WHOLESALE' | 'RETAIL';
  unit: PackagingUnitCode;
  labelSw: string;
  labelEn: string;
  quarterQuanta: number; // 1 Robo = 1 quantum (250g/250mL) -> Zero float drift
  priceTzs: number;
}

const SEED_CATALOG: CatalogTierItem[] = [
  // WHOLESALE (B2B): Magunia 50KG/25KG na Katoni kwa maduka ya mtaani
  {
    id: 'w-rice-50',
    sku: 'MC-MBY-50',
    nameSw: 'Mchele wa Mbeya Super',
    nameEn: 'Mbeya Super Grade Rice',
    channel: 'WHOLESALE',
    unit: 'SACK_50KG',
    labelSw: 'Gunia 50KG (Vipande 200 vya Robo)',
    labelEn: '50KG Sack (200x Quarter Quanta)',
    quarterQuanta: 200,
    priceTzs: 132_000,
  },
  {
    id: 'w-sugar-25',
    sku: 'SK-KLM-25',
    nameSw: 'Sukari ya Kilombero',
    nameEn: 'Kilombero Cane Sugar',
    channel: 'WHOLESALE',
    unit: 'SACK_25KG',
    labelSw: 'Gunia 25KG (Vipande 100 vya Robo)',
    labelEn: '25KG Sack (100x Quarter Quanta)',
    quarterQuanta: 100,
    priceTzs: 68_500,
  },
  {
    id: 'w-oil-ctn',
    sku: 'MF-KOR-CTN',
    nameSw: 'Mafuta ya Korie (Katoni 20L)',
    nameEn: 'Korie Cooking Oil (20L Carton)',
    channel: 'WHOLESALE',
    unit: 'CARTON',
    labelSw: 'Katoni (Vipande 80 vya Robo Lita)',
    labelEn: 'Carton (80x Quarter Litres)',
    quarterQuanta: 80,
    priceTzs: 94_000,
  },
  // RETAIL (B2C): Vipimo vya mtaani — Robo (1/4), Nusu (1/2), Tatu-Robo (3/4), Kilo/Lita 1
  {
    id: 'r-rice-robo',
    sku: 'MC-MBY-R',
    nameSw: 'Mchele wa Mbeya Super',
    nameEn: 'Mbeya Super Grade Rice',
    channel: 'RETAIL',
    unit: 'QUARTER_KILO_LITRE',
    labelSw: 'Robo Kilo (1/4 KG · 250g)',
    labelEn: 'Robo (1/4 KG · 250g)',
    quarterQuanta: 1,
    priceTzs: 750,
  },
  {
    id: 'r-rice-nusu',
    sku: 'MC-MBY-N',
    nameSw: 'Mchele wa Mbeya Super',
    nameEn: 'Mbeya Super Grade Rice',
    channel: 'RETAIL',
    unit: 'HALF_KILO_LITRE',
    labelSw: 'Nusu Kilo (1/2 KG · 500g)',
    labelEn: 'Nusu (1/2 KG · 500g)',
    quarterQuanta: 2,
    priceTzs: 1_500,
  },
  {
    id: 'r-sugar-tatu',
    sku: 'SK-KLM-TR',
    nameSw: 'Sukari ya Kilombero',
    nameEn: 'Kilombero Cane Sugar',
    channel: 'RETAIL',
    unit: 'THREE_QUARTER_KILO',
    labelSw: 'Tatu-Robo Kilo (3/4 KG · 750g)',
    labelEn: 'Tatu-Robo (3/4 KG · 750g)',
    quarterQuanta: 3,
    priceTzs: 2_300,
  },
  {
    id: 'r-oil-lita',
    sku: 'MF-KOR-1L',
    nameSw: 'Mafuta ya Korie',
    nameEn: 'Korie Cooking Oil',
    channel: 'RETAIL',
    unit: 'SINGLE_KILO_LITRE',
    labelSw: 'Lita 1 (1L · 1,000mL)',
    labelEn: 'Single Litre (1L · 1,000mL)',
    quarterQuanta: 4,
    priceTzs: 5_100,
  },
];

const IDB_NAME = 'sokokuu_hybrid_catalog_cache';
const IDB_STORE = 'catalog_items';

async function syncAndReadLocalCatalog(channel: 'WHOLESALE' | 'RETAIL'): Promise<CatalogTierItem[]> {
  return new Promise((resolve) => {
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        store.createIndex('by-channel', 'channel');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const writeTx = db.transaction(IDB_STORE, 'readwrite');
      const store = writeTx.objectStore(IDB_STORE);
      SEED_CATALOG.forEach((item) => store.put(item));
      writeTx.oncomplete = () => {
        const readTx = db.transaction(IDB_STORE, 'readonly');
        const index = readTx.objectStore(IDB_STORE).index('by-channel');
        const query = index.getAll(channel);
        query.onsuccess = () => resolve((query.result as CatalogTierItem[]) || []);
        query.onerror = () => resolve(SEED_CATALOG.filter((i) => i.channel === channel));
      };
    };
    req.onerror = () => resolve(SEED_CATALOG.filter((i) => i.channel === channel));
  });
}

export function HybridStorefrontPanel({ locale }: { locale: Locale }) {
  const isSw = locale === 'sw';
  const { activeViewChannel, setViewChannel } = useHybridMode();
  const [items, setItems] = useState<CatalogTierItem[]>([]);
  // 1x SACK_50KG = 200 integer quarter-quanta (Robo 250g) -> Zero float drift
  const [sackQuantaRemaining, setSackQuantaRemaining] = useState<number>(200);
  const [sellerTierTest, setSellerTierTest] = useState<'WHOLESALE_HUB' | 'HYBRID_STORE'>('WHOLESALE_HUB');
  const [guardMessage, setGuardMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    syncAndReadLocalCatalog(activeViewChannel).then((rows) => {
      if (active) setItems(rows);
    });
    return () => {
      active = false;
    };
  }, [activeViewChannel]);

  const handleDeconstructFraction = (quanta: number, label: string) => {
    if (quanta > sackQuantaRemaining) return;
    setSackQuantaRemaining((prev) => prev - quanta);
    setGuardMessage(
      isSw
        ? `Umeuza ${label} (-${quanta} Robo quanta). Mabaki ndani ya gunia la 50KG: ${sackQuantaRemaining - quanta}/200 quanta.`
        : `Sold ${label} (-${quanta} quarter-quanta). Remaining in cracked 50KG sack: ${sackQuantaRemaining - quanta}/200 quanta.`
    );
  };

  const handleTestTierConstraint = () => {
    if (sellerTierTest === 'WHOLESALE_HUB') {
      setGuardMessage(
        isSw
          ? 'Kizuizi cha Mfumo (P0001): Duka la Jumla haliruhusiwi kuweka bei ya Robo/Nusu/Tatu-Robo ili kulinda maduka ya rejareja.'
          : 'Tier Guardrail (P0001): Wholesale Hub cannot list fractional Robo/Nusu retail fractions.'
      );
    } else {
      setGuardMessage(
        isSw
          ? 'IMERUHUSIWA (Duka Mseto): Duka mseto linaruhusiwa kuuza Gunia 50 KG (B2B) na Robo/Nusu Kilo (B2C).'
          : 'ALLOWED (Hybrid Store): Hybrid store is authorized to sell 50 KG Sacks (B2B) and Robo/Nusu fractions (B2C).'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Hybrid Dashboard Header & "Badili Hali ya Duka" Switch */}
      <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Store className="w-5 h-5 text-emerald-700 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {isSw ? 'Badili Hali ya Duka (HybridModeContext)' : 'Badili Hali ya Duka — Dual-Mode Switch'}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                {isSw
                  ? 'Huchuja bidhaa moja kwa moja kutoka IndexedDB kulingana na mkondo wa Jumla au Rejareja.'
                  : 'Re-filters cached IndexedDB catalog locally between B2B bulk sacks and B2C Tanzanian market fractions.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setViewChannel('WHOLESALE')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                activeViewChannel === 'WHOLESALE'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Niko kama Jumla (B2B)
            </button>
            <button
              type="button"
              onClick={() => setViewChannel('RETAIL')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                activeViewChannel === 'RETAIL'
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Niko kama Rejareja (B2C)
            </button>
          </div>
        </div>

        {/* Filtered Catalog Table from IndexedDB */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                <th className="py-2.5 px-5">SKU</th>
                <th className="py-2.5 px-4">{isSw ? 'Bidhaa' : 'Product'}</th>
                <th className="py-2.5 px-4">{isSw ? 'Kipimo (Enum)' : 'Packaging Enum'}</th>
                <th className="py-2.5 px-4">{isSw ? 'Maelezo ya Kipimo' : 'Market Measure'}</th>
                <th className="py-2.5 px-5 text-right">{isSw ? 'Bei (TZS)' : 'Price (TZS)'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-5 font-mono text-xs text-slate-600 whitespace-nowrap">
                    {item.sku}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-900">
                    {isSw ? item.nameSw : item.nameEn}
                  </td>
                  <td className="py-2.5 px-4 text-xs font-medium text-emerald-800 whitespace-nowrap">
                    {formatUnitTypeLabel(item.unit, locale)}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-600">
                    {isSw ? item.labelSw : item.labelEn}
                  </td>
                  <td className="py-2.5 px-5 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                    TZS {item.priceTzs.toLocaleString('en-US')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Integer Inventory Deconstruction & Tier Guard Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                <span>
                  {isSw
                    ? 'Ugawaji wa Gunia 50KG Bila Makosa ya Desimali'
                    : 'Zero-Float 50KG Sack Deconstruction (Integer Quanta)'}
                </span>
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                1 × 50KG Sack = 200 Robo Quanta (250g each). Remaining:{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  {sackQuantaRemaining} / 200
                </strong>{' '}
                ({(sackQuantaRemaining * 0.25).toFixed(2)} KG)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSackQuantaRemaining(200)}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 underline whitespace-nowrap cursor-pointer"
            >
              {isSw ? 'Fungua Gunia Jipya' : 'Reset Sack'}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { q: 1, label: 'Robo (1/4 KG)' },
              { q: 2, label: 'Nusu (1/2 KG)' },
              { q: 3, label: 'Tatu-Robo (3/4 KG)' },
              { q: 4, label: 'Kilo 1 (4 Quanta)' },
            ].map((btn) => (
              <button
                key={btn.label}
                type="button"
                disabled={sackQuantaRemaining < btn.q}
                onClick={() => handleDeconstructFraction(btn.q, btn.label)}
                className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-45 whitespace-nowrap cursor-pointer"
              >
                Sell {btn.label}
              </button>
            ))}
          </div>
        </section>

        <section className="border border-slate-200 bg-white rounded-lg p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-700" aria-hidden="true" />
              <span>
                {isSw
                  ? 'Jaribio la Kizuizi cha Duka la Jumla (Trigger & Tier Validator)'
                  : 'Tier Rule Validator (PostgreSQL Trigger & Tier Guard)'}
              </span>
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Test inserting a <span className="font-semibold">Quarter Kilo / Litre</span> (Robo) listing or B2C order against seller tier:
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Seller Business Tier"
              value={sellerTierTest}
              onChange={(e) => setSellerTierTest(e.target.value as 'WHOLESALE_HUB' | 'HYBRID_STORE')}
              className="h-9 px-3 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
            >
              <option value="WHOLESALE_HUB">{formatBusinessTierLabel('WHOLESALE_HUB', locale)} (Pure Bulk)</option>
              <option value="HYBRID_STORE">{formatBusinessTierLabel('HYBRID_STORE', locale)} (Dual-Mode)</option>
            </select>
            <button
              type="button"
              onClick={handleTestTierConstraint}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Test Robo (1/4) Rule</span>
            </button>
          </div>
        </section>
      </div>

      {guardMessage && (
        <div
          className={`text-xs font-mono rounded-md px-4 py-3 border ${
            guardMessage.includes('ABORT')
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          {guardMessage}
        </div>
      )}
    </div>
  );
}
