import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Plus,
  RefreshCw,
  Tag,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import type { GlobalCatalogEntry } from '../lib/sokoManagedState';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';

export interface PricingTemplateSystemUnit {
  id: string;
  unitCode: string;
  nameSw: string;
  nameEn: string;
  category: 'WEIGHT' | 'VOLUME' | 'PACKAGING';
  abbreviation: string;
  isActive?: boolean;
}

export interface PricingTemplateRecord {
  id: string;
  templateName: string;
  systemUnit: PricingTemplateSystemUnit;
  packItemCount: number;
  unitMeasureValue: string;
  quarterQuantaTotal: number;
  pricingChannel: 'RETAIL' | 'WHOLESALE' | 'REGIONAL' | 'PROMOTIONAL';
  standardPriceTzs: number;
  version: number;
  isActive: boolean;
  attachedProductCount?: number;
}

type Channel = PricingTemplateRecord['pricingChannel'];

const CHANNELS: Channel[] = ['RETAIL', 'WHOLESALE', 'REGIONAL', 'PROMOTIONAL'];

function channelLabel(channel: Channel, isSw: boolean): string {
  switch (channel) {
    case 'RETAIL':
      return isSw ? 'Rejareja' : 'Retail';
    case 'WHOLESALE':
      return isSw ? 'Jumla' : 'Wholesale';
    case 'REGIONAL':
      return isSw ? 'Kikanda' : 'Regional';
    case 'PROMOTIONAL':
      return isSw ? 'Matangazo' : 'Promotional';
  }
}

function formatTzs(value: number): string {
  return value.toLocaleString('en-US');
}

/** Template preview built from display-only fields — no currency float math. */
function templateMeasure(template: Pick<PricingTemplateRecord, 'unitMeasureValue' | 'systemUnit'>): string {
  const code = template.systemUnit?.unitCode ?? '';
  if (/MILLI|ML/i.test(code)) return `${template.unitMeasureValue} mL`;
  if (/LITRE|LITER|^L$/i.test(code)) return `${template.unitMeasureValue} L`;
  if (/KILOGRAM|KG/i.test(code)) return `${template.unitMeasureValue} KG`;
  if (/GUNIA|SACK/i.test(code)) return `${template.unitMeasureValue} KG`;
  return template.unitMeasureValue;
}

/**
 * Reusable checkbox/chip editor: attaches a complete set of standalone
 * templates to one Global Catalog product. Used both in the dedicated
 * "Bei Elekezi" tab and inside product-level unit/pricing management.
 */
export function PricingTemplateAttachmentEditor({
  locale,
  globalCatalogId,
  compact = false,
}: {
  locale: Locale;
  globalCatalogId: string;
  compact?: boolean;
}) {
  const isSw = locale === 'sw';
  const [templates, setTemplates] = useState<PricingTemplateRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!globalCatalogId) return;
    setLoading(true);
    setError(null);
    try {
      const [allTemplates, attached] = await Promise.all([
        SokoApiClient.get<PricingTemplateRecord[]>('/admin/pricing-templates'),
        SokoApiClient.get<{ templates: PricingTemplateRecord[] }>(
          `/marketplace/catalog/${globalCatalogId}/pricing-templates`,
        ),
      ]);
      setTemplates(allTemplates ?? []);
      setSelectedIds(new Set((attached?.templates ?? []).map((t) => t.id)));
      setOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setOffline(true);
      } else {
        setError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia violezo vya bei.'
              : 'Failed to load pricing templates.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [globalCatalogId, isSw]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleTemplate = (templateId: string) => {
    setNotice(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  };

  const handleSave = async () => {
    setError(null);
    setNotice(null);
    if (selectedIds.size === 0) {
      setError(isSw ? 'Chagua angalau kiolezo kimoja.' : 'Select at least one pricing template.');
      return;
    }
    setSaving(true);
    try {
      const result = await SokoApiClient.post<{ templates: PricingTemplateRecord[] }>(
        `/admin/marketplace/catalog/${globalCatalogId}/attach-pricing-templates`,
        { templateIds: Array.from(selectedIds) },
      );
      setSelectedIds(new Set((result?.templates ?? []).map((t) => t.id)));
      setNotice(
        isSw
          ? 'Violezo vya bei vimeambatishwa kwenye bidhaa.'
          : 'Pricing templates attached to the product.',
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setOffline(true);
      } else {
        setError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kuambatisha violezo vya bei.'
              : 'Failed to attach pricing templates.',
        );
      }
    } finally {
      setSaving(false);
    }
  };

  if (!globalCatalogId) {
    return null;
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {offline && <BackendOfflineBanner locale={locale} />}
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
          {isSw ? 'Violezo vya Bei Vilivyoambatishwa' : 'Attached Pricing Templates'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:text-slate-900 cursor-pointer disabled:opacity-50"
            aria-label={isSw ? 'Onyo upya' : 'Refresh'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="px-3 py-1.5 text-[11px] font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
          >
            {saving
              ? isSw
                ? 'Inahifadhi...'
                : 'Saving...'
              : isSw
                ? 'Hifadhi viambatisho'
                : 'Save attachments'}
          </button>
        </div>
      </div>

      {loading && templates.length === 0 ? (
        <div className="text-xs text-slate-500 py-2">
          {isSw ? 'Inapakia violezo vya bei...' : 'Loading pricing templates...'}
        </div>
      ) : templates.length === 0 ? (
        <EmptyStateCard
          locale={locale}
          titleSw="Hakuna violezo vya bei"
          titleEn="No pricing templates yet"
          descriptionSw="Unda kiolezo kwenye tab ya Bei Elekezi kwanza."
          descriptionEn="Create a template in the Bei Elekezi tab first."
        />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {templates.map((template) => {
            const checked = selectedIds.has(template.id);
            return (
              <label
                key={template.id}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] cursor-pointer transition-colors ${
                  checked
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleTemplate(template.id)}
                  className="w-3 h-3 accent-emerald-600"
                />
                <span className="font-semibold">{template.templateName}</span>
                <span className="font-mono text-[10px] opacity-70">
                  TZS {formatTzs(template.standardPriceTzs)}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminPricingTemplatesPanel({
  locale,
  catalog,
  initialCatalogId,
}: {
  locale: Locale;
  catalog: GlobalCatalogEntry[];
  initialCatalogId?: string;
}) {
  const isSw = locale === 'sw';
  const [templates, setTemplates] = useState<PricingTemplateRecord[]>([]);
  const [units, setUnits] = useState<PricingTemplateSystemUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>('');

  const [templateName, setTemplateName] = useState<string>('');
  const [systemUnitId, setSystemUnitId] = useState<string>('');
  const [packItemCount, setPackItemCount] = useState<string>('1');
  const [unitMeasureValue, setUnitMeasureValue] = useState<string>('');
  const [quarterQuantaTotal, setQuarterQuantaTotal] = useState<string>('4');
  const [pricingChannel, setPricingChannel] = useState<Channel>('RETAIL');
  const [standardPriceTzs, setStandardPriceTzs] = useState<string>('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [templateRows, unitRows] = await Promise.all([
        SokoApiClient.get<PricingTemplateRecord[]>('/admin/pricing-templates?includeInactive=true'),
        SokoApiClient.get<PricingTemplateSystemUnit[]>('/admin/units?includeInactive=true'),
      ]);
      setTemplates(templateRows ?? []);
      setUnits((unitRows ?? []).filter((u) => u.isActive !== false));
      setSystemUnitId((prev) => prev || (unitRows ?? [])[0]?.id || '');
      setOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setOffline(true);
      } else {
        setError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia violezo vya bei na vipimo.'
              : 'Failed to load pricing templates and units.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [isSw]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (initialCatalogId) setSelectedCatalogId(initialCatalogId);
    else if (!selectedCatalogId && catalog.length > 0) setSelectedCatalogId(catalog[0].globalCatalogId);
  }, [initialCatalogId, catalog, selectedCatalogId]);

  const activeTemplateCount = useMemo(
    () => templates.filter((t) => t.isActive).length,
    [templates],
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await SokoApiClient.post('/admin/pricing-templates', {
        templateName: templateName.trim(),
        systemUnitId,
        packItemCount: Math.max(1, Math.trunc(Number(packItemCount) || 1)),
        unitMeasureValue: unitMeasureValue.trim(),
        quarterQuantaTotal: Math.max(1, Math.trunc(Number(quarterQuantaTotal) || 1)),
        pricingChannel,
        standardPriceTzs: Math.max(1, Math.trunc(Number(standardPriceTzs) || 0)),
      });
      setTemplateName('');
      setUnitMeasureValue('');
      setStandardPriceTzs('');
      setNotice(
        isSw
          ? 'Kiolezo kipya cha bei kimeundwa.'
          : 'Standalone pricing template created.',
      );
      await loadAll();
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setOffline(true);
      } else {
        setError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kuunda kiolezo cha bei.'
              : 'Failed to create pricing template.',
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {isSw ? 'Bei Elekezi (Violezo Vinavyoweza Kutumika Ten)' : 'Pricing Templates (Reusable)'}
              </h2>
              <p className="text-xs text-slate-500">
                {isSw
                  ? 'Unda kiolezo mara moja, kisha kiamabatisha kwenye bidhaa yoyote ya Katalogi.'
                  : 'Create once, attach to any Global Catalog product. Merchant overrides stay isolated.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            className="p-2 rounded-md border border-slate-200 text-slate-500 hover:text-slate-900 cursor-pointer disabled:opacity-50"
            aria-label={isSw ? 'Onyo upya' : 'Refresh'}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {offline && <BackendOfflineBanner locale={locale} />}
        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block space-y-1 lg:col-span-2">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? '1. Jina la Bei (Template Name)' : '1. Template Name'}
            </span>
            <input
              required
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder={isSw ? '1.6 L Katoni (Chupa 6)' : '1.6 L Carton (6 bottles)'}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? '2. Chagua Kipimo' : '2. Select Unit'}
            </span>
            <select
              required
              value={systemUnitId}
              onChange={(e) => setSystemUnitId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            >
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.unitCode} — {isSw ? unit.nameSw : unit.nameEn}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? '3. Aina ya Bei' : '3. Channel'}
            </span>
            <select
              value={pricingChannel}
              onChange={(e) => setPricingChannel(e.target.value as Channel)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            >
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {channel} ({channelLabel(channel, isSw)})
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? '4. Idadi Kwenye Kifurushi' : '4. Pack Count'}
            </span>
            <input
              type="number"
              min={1}
              required
              value={packItemCount}
              onChange={(e) => setPackItemCount(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Thamani ya Kipimo (onyesho)' : 'Measure Value (display)'}
            </span>
            <input
              required
              value={unitMeasureValue}
              onChange={(e) => setUnitMeasureValue(e.target.value)}
              placeholder={isSw ? '1.6 au 300 au 50' : '1.6 or 300 or 50'}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? 'Quarter-Quanta (hifadhi)' : 'Quarter-Quanta (stock)'}
            </span>
            <input
              type="number"
              min={1}
              required
              value={quarterQuantaTotal}
              onChange={(e) => setQuarterQuantaTotal(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700">
              {isSw ? '5. Bei Elekezi (TZS)' : '5. Standard Price (TZS)'}
            </span>
            <input
              type="number"
              min={1}
              required
              value={standardPriceTzs}
              onChange={(e) => setStandardPriceTzs(e.target.value)}
              placeholder={isSw ? '3300' : '3300'}
              className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg"
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              {saving
                ? isSw
                  ? 'Inahifadhi...'
                  : 'Saving...'
                : isSw
                  ? 'Unda Kiolezo'
                  : 'Create Template'}
            </button>
          </div>
        </form>
      </section>

      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-slate-900">
            {isSw ? 'Violezo Vilivyosajiliwa' : 'Registered Pricing Templates'} (
            {activeTemplateCount})
          </h3>
          <span className="text-[11px] text-slate-500 font-mono">
            {isSw
              ? 'Vimehifadhiwa kama vitu vinavyojitegemea'
              : 'Stored as standalone objects'}
          </span>
        </div>

        {templates.length === 0 ? (
          <EmptyStateCard
            locale={locale}
            titleSw="Hakuna violezo vya bei bado"
            titleEn="No pricing templates yet"
            descriptionSw="Tumia fomu iliyo hapo juu kuunda kiolezo cha kwanza."
            descriptionEn="Use the form above to create the first template."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((template) => (
              <div
                key={template.id}
                className="border border-slate-200 rounded-lg p-3 bg-slate-50/60 space-y-1.5"
              >
                <div className="text-sm font-bold text-slate-900">{template.templateName}</div>
                <div className="text-[11px] font-mono text-slate-500">
                  {template.systemUnit.unitCode} · {channelLabel(template.pricingChannel, isSw)} · v
                  {template.version}
                </div>
                <div className="text-lg font-bold font-mono tabular-nums text-emerald-700">
                  TZS {formatTzs(template.standardPriceTzs)}
                </div>
                <div className="text-[11px] text-slate-500 font-mono">
                  {templateMeasure(template)} · {template.packItemCount}{' '}
                  {isSw ? 'kipande/kifurushi' : 'item(s)/pack'} · {template.quarterQuantaTotal} Q ·{' '}
                  {template.attachedProductCount ?? 0} {isSw ? 'bidhaa' : 'products'}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">
            {isSw ? 'Uambatishaji wa Bidhaa' : 'Product Attachment'}
          </h3>
          <select
            value={selectedCatalogId}
            onChange={(e) => setSelectedCatalogId(e.target.value)}
            className="px-3 py-1.5 min-h-[36px] text-xs font-mono rounded-lg border border-slate-200 bg-white text-slate-900"
          >
            {catalog.map((item) => (
              <option key={item.globalCatalogId} value={item.globalCatalogId}>
                {item.canonicalSku} — {isSw ? item.fixedNameSw : item.fixedNameEn}
              </option>
            ))}
          </select>
        </div>
        <PricingTemplateAttachmentEditor
          locale={locale}
          globalCatalogId={selectedCatalogId}
        />
      </section>
    </div>
  );
}
