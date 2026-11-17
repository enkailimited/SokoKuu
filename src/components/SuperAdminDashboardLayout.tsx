import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  Container,
  Copy,
  Database,
  FileCode2,
  FolderPlus,
  Gauge,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Lock,
  MapPin,
  Menu,
  MessageSquareCode,
  Navigation,
  PackagePlus,
  Percent,
  Plus,
  Scale,
  Search,
  ShieldCheck,
  Smartphone,
  Store,
  TrendingUp,
  X,
} from 'lucide-react';
import { CODE_ARTIFACTS, type CodeArtifact } from '../data/blueprints';
import { TRANSLATIONS, type Locale } from '../data/i18n';
import { SokoApiClient } from '../services/sokoApiClient';
import {
  ADMIN_ALERT_CHANNEL_NAME,
  addCatalogCategory,
  addGlobalCatalogEntry,
  formatCodeWithoutUnderscores,
  incrementCatalogCloneCounter,
  loadCatalogCategories,
  loadDispatchAuditTraces,
  loadGlobalCatalogEntries,
  type CatalogCategoryRecord,
  type GlobalCatalogEntry,
  type OrderDispatchAuditTrace,
} from '../lib/sokoManagedState';
import { AdminAlertTerminal } from './AdminAlertTerminal';
import { AdminShopsDirectoryPanel } from './AdminShopsDirectoryPanel';
import { AdminUnitsAndPricingPanel } from './AdminUnitsAndPricingPanel';
import { BrandLogo } from './BrandLogo';
import { CodeViewer } from './CodeViewer';
import { ConcurrencySmsCsvPanel } from './ConcurrencySmsCsvPanel';
import { DevOpsRetentionPanel } from './DevOpsRetentionPanel';
import { DynamicPricingRouterPanel } from './DynamicPricingRouterPanel';
import { HybridAnalyticsDashboard } from './HybridAnalyticsDashboard';
import { HybridStorefrontPanel } from './HybridStorefrontPanel';
import {
  DualPinReconciliationSimulator,
  NextSmsPayloadSimulator,
  OfflineQueueSimulator,
  RbacMatrixPanel,
  TieredPricingSimulator,
} from './InteractiveSimulators';
import { FullPageMarketplaceMap } from './FullPageMarketplaceMap';
import { ManagedOrderInterceptorPanel } from './ManagedOrderInterceptorPanel';
import { OptimizationLabPanel } from './OptimizationLabPanel';
import { SalesLeadsDashboard } from './SalesLeadsDashboard';
import { WholesalerEodReconciliation } from './WholesalerEodReconciliation';

export type AdminSectionKey =
  | 'metrics'
  | 'alarms'
  | 'shops'
  | 'map_matrix'
  | 'leads'
  | 'catalog'
  | 'categories'
  | 'units'
  | 'vault';
export type AdminModuleKey = CodeArtifact['section'];

const ADMIN_DOC_MODULES: Array<{ key: AdminModuleKey; icon: typeof ShieldCheck }> = [
  { key: 'admin_security', icon: Lock },
  { key: 'database', icon: Database },
  { key: 'security', icon: ShieldCheck },
  { key: 'nextsms', icon: MessageSquareCode },
  { key: 'reconciliation', icon: KeyRound },
  { key: 'eod', icon: ClipboardCheck },
  { key: 'optimization', icon: Gauge },
  { key: 'hybrid', icon: Store },
  { key: 'pricing_router', icon: Percent },
  { key: 'analytics', icon: BarChart3 },
  { key: 'qa_export', icon: Activity },
  { key: 'devops', icon: Container },
  { key: 'pwa', icon: Smartphone },
];

const FALLBACK_SVG_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="8" fill="#f1f5f9"/><path d="M28 60l12-14 10 11 8-9 10 12H28z" fill="#94a3b8"/><circle cx="36" cy="34" r="5" fill="#cbd5e1"/></svg>'
  );

function CatalogThumbnail({
  srcUrl,
  fallbackUrl,
  alt,
  sizeClass = 'w-12 h-12',
}: {
  srcUrl: string;
  fallbackUrl?: string;
  alt: string;
  sizeClass?: string;
}) {
  const [src, setSrc] = useState<string>(srcUrl || fallbackUrl || FALLBACK_SVG_PLACEHOLDER);

  useEffect(() => {
    setSrc(srcUrl || fallbackUrl || FALLBACK_SVG_PLACEHOLDER);
  }, [srcUrl, fallbackUrl]);

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => {
        if (fallbackUrl && src !== fallbackUrl) {
          setSrc(fallbackUrl);
        } else if (src !== FALLBACK_SVG_PLACEHOLDER) {
          setSrc(FALLBACK_SVG_PLACEHOLDER);
        }
      }}
      className={`${sizeClass} rounded-lg object-cover border border-slate-200 bg-slate-50 shrink-0`}
    />
  );
}

// ============================================================================
// SuperAdminDashboardLayout.tsx
// White-Label Admin Workspace (Serverless Database Engine / Cloud SQL Cluster)
// Permanent Left Sidebar: w-64 bg-white min-h-screen border-r border-slate-100
// ============================================================================
export function SuperAdminDashboardLayout({
  locale = 'sw',
  authority,
  mobileSidebarOpen: controlledMobileOpen,
  onMobileSidebarOpenChange,
}: {
  locale?: Locale;
  authority: string;
  mobileSidebarOpen?: boolean;
  onMobileSidebarOpenChange?: (open: boolean) => void;
}) {
  const isSw = locale === 'sw';
  const t = TRANSLATIONS[locale];

  const [activeSection, setActiveSection] = useState<AdminSectionKey>('metrics');
  const [internalMobileOpen, setInternalMobileOpen] = useState<boolean>(false);
  const mobileSidebarOpen = controlledMobileOpen ?? internalMobileOpen;
  const setMobileSidebarOpen = (open: boolean) => {
    setInternalMobileOpen(open);
    onMobileSidebarOpenChange?.(open);
  };
  const [selectedDocModule, setSelectedDocModule] = useState<AdminModuleKey>('admin_security');

  const [catalogEntries, setCatalogEntries] = useState<GlobalCatalogEntry[]>(() =>
    loadGlobalCatalogEntries()
  );
  const [categories, setCategories] = useState<CatalogCategoryRecord[]>(() =>
    loadCatalogCategories()
  );
  const [managedAlarmCount, setManagedAlarmCount] = useState<number>(() =>
    loadDispatchAuditTraces().filter((tr) => tr.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK').length
  );
  const [liveIncomingAlarms, setLiveIncomingAlarms] = useState<number>(0);

  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [adminToast, setAdminToast] = useState<string | null>(null);

  // Action Modals
  const [showCategoryModal, setShowCategoryModal] = useState<boolean>(false);
  const [showProductModal, setShowProductModal] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Category Form State (hyphenated clean code, no underscores shown in UI)
  const [newCategoryCode, setNewCategoryCode] = useState<string>('Vinywaji Baridi');
  const [newCategoryNameSw, setNewCategoryNameSw] = useState<string>('Vinywaji Baridi');
  const [newCategoryNameEn, setNewCategoryNameEn] = useState<string>('Cold Beverages');
  const [newImagekitFolder, setNewImagekitFolder] = useState<string>(
    '/sokokuutz/catalog/cold-beverages'
  );

  // Product Form State
  const [newSku, setNewSku] = useState<string>('GC-AZM-JUICE');
  const [newProductNameSw, setNewProductNameSw] = useState<string>(
    'Juisi ya Embe ya Azam (Lita 1 Standard)'
  );
  const [newProductNameEn, setNewProductNameEn] = useState<string>(
    'Azam Mango Juice (1L Standard)'
  );
  const [selectedCategoryCode, setSelectedCategoryCode] = useState<string>(
    categories[0]?.categoryCode ?? 'NAFAKA_UNGA'
  );
  const [newImagekitUrlOverride, setNewImagekitUrlOverride] = useState<string>(
    'https://ik.imagekit.io/sokokuutz/tr:w-320,h-320,fo-auto,f-webp,q-80/catalog/cold-beverages/azam_mango_1l.webp'
  );

  useEffect(() => {
    const refreshCatalog = () => setCatalogEntries(loadGlobalCatalogEntries());
    const refreshOrderCounts = () => {
      const managed = loadDispatchAuditTraces().filter(
        (tr) => tr.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK'
      );
      setManagedAlarmCount(managed.length);
      setLiveIncomingAlarms(managed.filter((tr) => (tr.adminStatus ?? 'PENDING') === 'PENDING').length);
    };

    const handleLiveAlert = (evt: Event) => {
      const detail = (evt as CustomEvent<OrderDispatchAuditTrace>).detail;
      if (detail?.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK') {
        refreshOrderCounts();
      }
    };

    window.addEventListener('sokokuu:catalog-updated', refreshCatalog);
    window.addEventListener('sokokuu:orders-updated', refreshOrderCounts);
    window.addEventListener('storage', refreshCatalog);
    window.addEventListener('storage', refreshOrderCounts);
    window.addEventListener('sokokuu:managed-order-alert', handleLiveAlert);

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      try {
        channel = new BroadcastChannel(ADMIN_ALERT_CHANNEL_NAME);
        channel.onmessage = (msg) => {
          const payload = msg.data as OrderDispatchAuditTrace | undefined;
          if (payload?.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK') {
            refreshOrderCounts();
          }
        };
      } catch {
        // ignore BroadcastChannel errors
      }
    }

    return () => {
      window.removeEventListener('sokokuu:catalog-updated', refreshCatalog);
      window.removeEventListener('sokokuu:orders-updated', refreshOrderCounts);
      window.removeEventListener('storage', refreshCatalog);
      window.removeEventListener('storage', refreshOrderCounts);
      window.removeEventListener('sokokuu:managed-order-alert', handleLiveAlert);
      channel?.close();
    };
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowCategoryModal(false);
        setShowProductModal(false);
        setModalError(null);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  if (authority !== 'SUPER_ADMIN') {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <section className="border border-red-200 bg-red-50 rounded-lg p-6 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
            <Lock className="w-4 h-4 text-red-700" aria-hidden="true" />
            <span>HTTP 403 FORBIDDEN — Admin Console</span>
          </div>
          <p className="text-xs text-red-800">
            {isSw
              ? 'Imefungwa kwa mamlaka ya Msimamizi Mkuu pekee.'
              : 'Restricted strictly to Super Admin authority.'}
          </p>
        </section>
      </div>
    );
  }

  const totalStoreAdoptions = catalogEntries.reduce(
    (sum, item) => sum + item.clonedByStoresCount,
    0
  );

  const filteredCatalog = catalogEntries.filter((item) => {
    const matchesCategory = categoryFilter === 'ALL' || item.categoryCode === categoryFilter;
    const q = catalogSearch.trim().toLowerCase();
    const matchesSearch =
      q.length === 0 ||
      item.canonicalSku.toLowerCase().includes(q) ||
      item.fixedNameSw.toLowerCase().includes(q) ||
      item.fixedNameEn.toLowerCase().includes(q) ||
      item.imagekitCdnUrl.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  const handleSimulateAtomicClone = (entry: GlobalCatalogEntry) => {
    const updated = incrementCatalogCloneCounter(entry.globalCatalogId);
    setCatalogEntries(updated);
    setAdminToast(
      isSw
        ? `${entry.canonicalSku} -> Inatumiwa na Wafanyabiashara: ${entry.clonedByStoresCount + 1} (Hifadhidata ya SokoKuu imesasishwa).`
        : `${entry.canonicalSku} -> Cloned by Merchants: ${entry.clonedByStoresCount + 1} (Cloud Database Core updated).`
    );
  };

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    const cleanCode = newCategoryCode
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_');

    if (!cleanCode || !newCategoryNameSw.trim() || !newCategoryNameEn.trim()) {
      setModalError(isSw ? 'Jaza sehemu zote.' : 'All fields are required.');
      return;
    }

    if (categories.some((c) => c.categoryCode === cleanCode)) {
      setModalError(
        isSw
          ? `HTTP 409 CONFLICT: Kategoria "${cleanCode}" tayari ipo.`
          : `HTTP 409 CONFLICT: Category code "${cleanCode}" already exists.`
      );
      return;
    }

    const cleanFolder = newImagekitFolder.trim().startsWith('/')
      ? newImagekitFolder.trim()
      : `/${newImagekitFolder.trim()}`;

    const record: CatalogCategoryRecord = {
      categoryId: 'cat-' + Math.random().toString(36).substring(2, 7),
      categoryCode: cleanCode,
      nameSw: newCategoryNameSw.trim(),
      nameEn: newCategoryNameEn.trim(),
      imagekitFolderPath: cleanFolder,
      createdAtEat: new Date().toLocaleTimeString(),
    };

    const next = addCatalogCategory(record);
    setCategories(next);
    setSelectedCategoryCode(cleanCode);
    setShowCategoryModal(false);
    setAdminToast(
      isSw
        ? `Kategoria "${record.nameSw}" imehifadhiwa kwenye Hifadhidata ya SokoKuu.`
        : `Category "${record.nameEn}" committed to SokoKuu Cloud SQL Cluster.`
    );
  };

  const handleIngestCatalogProduct = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    const sku = newSku.trim().toUpperCase();
    const cdnUrl = newImagekitUrlOverride.trim();

    if (!sku || !newProductNameSw.trim() || !newProductNameEn.trim()) {
      setModalError(isSw ? 'Jaza SKU na majina rasmi.' : 'SKU and canonical names are required.');
      return;
    }

    if (!/^https:\/\/ik\.imagekit\.io\/[a-zA-Z0-9_-]+\/.+$/.test(cdnUrl)) {
      setModalError(
        isSw
          ? 'URL lazima iwe anuani halisi ya ImageKit CDN (https://ik.imagekit.io/...).'
          : 'Asset URL must be an absolute ImageKit.io CDN pointer (https://ik.imagekit.io/...).'
      );
      return;
    }

    if (catalogEntries.some((item) => item.canonicalSku === sku)) {
      setModalError(
        isSw
          ? `HTTP 409 CONFLICT (SERIALIZABLE): SKU "${sku}" tayari ipo.`
          : `HTTP 409 CONFLICT (SERIALIZABLE): Canonical SKU "${sku}" already exists.`
      );
      return;
    }

    const targetCategory =
      categories.find((c) => c.categoryCode === selectedCategoryCode) ?? categories[0];

    const created: GlobalCatalogEntry = {
      globalCatalogId: 'gc-' + Math.random().toString(36).substring(2, 9),
      canonicalSku: sku,
      fixedNameSw: newProductNameSw.trim(),
      fixedNameEn: newProductNameEn.trim(),
      category: targetCategory ? (isSw ? targetCategory.nameSw : targetCategory.nameEn) : 'General',
      categoryCode: targetCategory?.categoryCode ?? 'GENERAL',
      imagekitCdnUrl: cdnUrl,
      staticImageUrl: FALLBACK_SVG_PLACEHOLDER,
      defaultBaseUnitSw: 'Quanta (Robo 250g/mL)',
      defaultBaseUnitEn: 'Quanta (250g/mL Base)',
      clonedByStoresCount: 0,
      updatedAtEat: new Date().toLocaleTimeString(),
    };

    const next = addGlobalCatalogEntry(created);
    setCatalogEntries(next);
    setShowProductModal(false);
    setNewSku('GC-' + Math.random().toString(36).substring(2, 6).toUpperCase());
    setNewProductNameSw('');
    setNewProductNameEn('');
    setAdminToast(
      isSw
        ? `${sku} imeongezwa (/api/v1/admin/marketplace/catalog/add-item) -> Hifadhidata ya SokoKuu.`
        : `${sku} added via /api/v1/admin/marketplace/catalog/add-item -> Cloud Database Core.`
    );
    setActiveSection('catalog');
  };

  const navItems: Array<{
    key: AdminSectionKey;
    labelSw: string;
    labelEn: string;
    metaSw: string;
    metaEn: string;
    icon: typeof Activity;
  }> = [
    {
      key: 'metrics',
      labelSw: 'Vipimo vya Mfumo & HikariCP',
      labelEn: 'System Metrics & HikariCP',
      metaSw: 'Serverless SQL Cluster',
      metaEn: 'Serverless Database Engine',
      icon: Activity,
    },
    {
      key: 'alarms',
      labelSw: 'Oda za Moja kwa Moja',
      labelEn: 'Live Admin Orders',
      metaSw: `${managedAlarmCount} Oda (Admin Pekee)`,
      metaEn: `${managedAlarmCount} Admin-Only Queue`,
      icon: BellRing,
    },
    {
      key: 'shops',
      labelSw: 'Wafanyabiashara & Mipangilio',
      labelEn: 'Merchants & Settings',
      metaSw: 'Uelekezaji · Ruhusa za Wafanyabiashara',
      metaEn: 'Routing · Merchant Permissions',
      icon: Store,
    },
    {
      key: 'map_matrix',
      labelSw: 'Ramani ya Wafanyabiashara (GIS)',
      labelEn: 'Proximity Map Matrix',
      metaSw: 'PostGIS · Live Nodes',
      metaEn: 'PostGIS · Live Nodes',
      icon: Navigation,
    },
    {
      key: 'leads',
      labelSw: 'Mauzo & Wateja (GPS)',
      labelEn: 'Sales Leads (GPS)',
      metaSw: 'Geolocation · NextSMS PIN4',
      metaEn: 'Geolocation · NextSMS PIN4',
      icon: MapPin,
    },
    {
      key: 'catalog',
      labelSw: 'Global Catalog Manager',
      labelEn: 'Global Catalog Manager',
      metaSw: `${catalogEntries.length} Bidhaa · ImageKit`,
      metaEn: `${catalogEntries.length} SKUs · ImageKit`,
      icon: Layers,
    },
    {
      key: 'categories',
      labelSw: 'Usimamizi wa Kategoria',
      labelEn: 'Category Registry',
      metaSw: `${categories.length} Kategoria za CDN`,
      metaEn: `${categories.length} CDN Folders`,
      icon: FolderPlus,
    },
    {
      key: 'units',
      labelSw: 'Vipimo & Bei Sanifu',
      labelEn: 'Units & Standard Pricing',
      metaSw: 'Sajili ya Vipimo · Kanuni ya Bei',
      metaEn: 'Canonical Units · Pricing Guard',
      icon: Scale,
    },
    {
      key: 'vault',
      labelSw: 'Hazina ya Msimbo',
      labelEn: 'Architecture Vault',
      metaSw: `${CODE_ARTIFACTS.length} Faili`,
      metaEn: `${CODE_ARTIFACTS.length} Blueprints`,
      icon: FileCode2,
    },
  ];

  const moduleArtifacts = CODE_ARTIFACTS.filter((a) => a.section === selectedDocModule);

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-slate-100 space-y-2">
        <BrandLogo size="sm" />
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900 truncate">
            {isSw ? 'Dashibodi ya Super Admin' : 'Super Admin Control'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 font-mono truncate">
            Cloud Database Core · STOMP
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-1" aria-label="Super Admin Sidebar">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setActiveSection(item.key);
                setMobileSidebarOpen(false);
              }}
              className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-start gap-3 cursor-pointer ${
                isActive
                  ? 'bg-emerald-50 text-emerald-950 border border-emerald-200'
                  : 'text-slate-700 hover:bg-slate-50 border border-transparent'
              }`}
            >
              <Icon
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  isActive ? 'text-emerald-600' : 'text-slate-400'
                }`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">
                  {isSw ? item.labelSw : item.labelEn}
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5 font-mono">
                  {isSw ? item.metaSw : item.metaEn}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-100 bg-slate-50/70 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-600">
          <span className="font-semibold">
            {isSw ? 'Kengele za STOMP' : 'STOMP Alarms'}
          </span>
          <span className="font-mono font-bold text-emerald-600 tabular-nums">
            {managedAlarmCount}
          </span>
        </div>
        <div className="text-[11px] font-mono text-slate-500 truncate">
          ik.imagekit.io/sokokuutz/
        </div>
        <div className="text-xs font-mono font-semibold text-emerald-600 tabular-nums">
          Inatumiwa na Wafanyabiashara: {totalStoreAdoptions.toLocaleString('en-US')}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-1 min-h-screen bg-slate-50 w-full relative">
      {/* Truly Fixed Left Sidebar on Desktop (w-64 bg-white min-h-screen border-r border-slate-100) */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:left-0 lg:top-16 lg:bottom-0 w-64 bg-white min-h-screen border-r border-slate-100 z-30 overflow-y-auto">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside className="relative w-64 bg-white min-h-screen border-r border-slate-100 z-10 flex flex-col">
            <div className="flex items-center justify-end px-3 pt-3">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Close sidebar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Content Workspace (Offset by fixed w-64 sidebar on lg+) */}
      <div className="flex-1 min-w-0 lg:pl-64 p-4 sm:p-6 space-y-5">
        {/* Compact Workspace Bar */}
        <div className="bg-white border border-slate-100 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            {onMobileSidebarOpenChange === undefined && (
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
                aria-label="Open admin menu"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
            <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate">
              {navItems.find((n) => n.key === activeSection)?.[isSw ? 'labelSw' : 'labelEn']}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setModalError(null);
                setShowCategoryModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              <span>{isSw ? '+ Kategoria' : '+ New Category'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setModalError(null);
                setShowProductModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isSw ? '+ Bidhaa Kuu' : '+ Add Catalog Item'}</span>
            </button>
          </div>
        </div>

        {adminToast && (
          <div
            role="status"
            className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-semibold text-emerald-950"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>{adminToast}</span>
            </div>
            <button
              type="button"
              onClick={() => setAdminToast(null)}
              className="text-emerald-800 hover:text-emerald-950 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* VIEW 1: SYSTEM METRICS & HIKARICP */}
        {activeSection === 'metrics' && (
          <div className="space-y-5">
            <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-white border border-slate-100 rounded-lg shadow-sm divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
              <div className="p-4 space-y-1">
                <div className="text-xs text-slate-500">
                  {isSw ? 'Injini ya Hifadhidata' : 'Serverless Database Engine'}
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-600">
                  TLS 1.3 · OK
                </div>
                <div className="text-xs font-mono text-slate-500">
                  SokoKuu Cloud SQL Cluster
                </div>
              </div>
              <div className="p-4 space-y-1">
                <div className="text-xs text-slate-500">HikariPool Active / Max</div>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
                  6 / 32
                </div>
                <div className="text-xs font-mono text-slate-500">
                  SERIALIZABLE · 5s Tx Guard
                </div>
              </div>
              <div className="p-4 space-y-1">
                <div className="text-xs text-slate-500">
                  {isSw ? 'Kengele za Oda (STOMP)' : 'STOMP Live Alarms'}
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-600">
                  {managedAlarmCount}{' '}
                  {liveIncomingAlarms > 0 && (
                    <span className="text-xs text-amber-700">(+{liveIncomingAlarms})</span>
                  )}
                </div>
                <div className="text-xs font-mono text-slate-500">
                  /topic/admin/managed-alerts
                </div>
              </div>
              <div className="p-4 space-y-1">
                <div className="text-xs text-slate-500">
                  {isSw ? 'Matumizi ya Katalogi' : 'Global Catalog Adoptions'}
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
                  {totalStoreAdoptions.toLocaleString('en-US')}
                </div>
                <div className="text-xs font-mono text-slate-500">
                  Inatumiwa na Wafanyabiashara: {totalStoreAdoptions}
                </div>
              </div>
            </section>

            <OptimizationLabPanel locale={locale} />
            <DevOpsRetentionPanel locale={locale} />
          </div>
        )}

        {/* VIEW 2: LIVE ADMIN-ONLY ORDERS */}
        {activeSection === 'alarms' && <AdminAlertTerminal locale={locale} />}

        {/* VIEW 2A: REGISTERED SHOPS LIST & SETTINGS */}
        {activeSection === 'shops' && <AdminShopsDirectoryPanel locale={locale} />}

        {/* VIEW 2B: FULL-PAGE PROXIMITY MAP MATRIX */}
        {activeSection === 'map_matrix' && (
          <FullPageMarketplaceMap
            locale={locale}
            authority="SUPER_ADMIN"
            onOpenShopsSettings={() => setActiveSection('shops')}
          />
        )}

        {/* VIEW 2C: FIELD SALES LEADS & GPS CONVERSION ENGINE */}
        {activeSection === 'leads' && <SalesLeadsDashboard locale={locale} />}

        {/* VIEW 3: GLOBAL CATALOG MANAGER */}
        {activeSection === 'catalog' && (
          <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="text-xs font-bold text-slate-900">
                {isSw ? 'Orodha ya Bidhaa Sanifu (ImageKit CDN)' : 'Canonical Products Grid (ImageKit CDN)'}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search
                    className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder={isSw ? 'Tafuta SKU...' : 'Filter SKU...'}
                    className="pl-8 pr-3 py-1.5 min-h-[36px] text-xs rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-3 py-1.5 min-h-[36px] text-xs rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="ALL">{isSw ? 'Kategoria Zote' : 'All Categories'}</option>
                  {categories.map((cat) => (
                    <option key={cat.categoryId} value={cat.categoryCode}>
                      {isSw ? cat.nameSw : cat.nameEn}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filteredCatalog.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                {isSw ? 'Hakuna bidhaa zilizopatikana.' : 'No matching catalog entries.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">{isSw ? 'Bidhaa & Picha' : 'Product & ImageKit'}</th>
                      <th className="py-2.5 px-3">{isSw ? 'Kategoria' : 'Category'}</th>
                      <th className="py-2.5 px-3">ImageKit URL</th>
                      <th className="py-2.5 px-3 text-right">{isSw ? 'Takwimu za Maduka' : 'Store Adoption'}</th>
                      <th className="py-2.5 px-3 text-right">{isSw ? 'Nakili' : 'Trigger'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCatalog.map((entry) => (
                      <tr key={entry.globalCatalogId} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-3 min-w-[210px]">
                            <CatalogThumbnail
                              srcUrl={entry.imagekitCdnUrl}
                              fallbackUrl={entry.staticImageUrl}
                              alt={isSw ? entry.fixedNameSw : entry.fixedNameEn}
                            />
                            <div className="min-w-0">
                              <div className="font-mono font-bold text-slate-900">
                                {entry.canonicalSku}
                              </div>
                              <div className="text-slate-700 font-medium truncate max-w-[220px]">
                                {isSw ? entry.fixedNameSw : entry.fixedNameEn}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                          <div className="font-medium text-slate-900">{entry.category}</div>
                          <div className="text-[11px] text-slate-500">
                            {formatCodeWithoutUnderscores(entry.categoryCode)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 max-w-[250px]">
                          <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-600 truncate">
                            <ImageIcon
                              className="w-3.5 h-3.5 text-emerald-600 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="truncate" title={entry.imagekitCdnUrl}>
                              {entry.imagekitCdnUrl}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-200 bg-emerald-50 font-mono text-xs font-bold text-emerald-800 tabular-nums">
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                            <span>
                              Inatumiwa na Wafanyabiashara: {entry.clonedByStoresCount.toLocaleString('en-US')}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleSimulateAtomicClone(entry)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 hover:text-emerald-900 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                            <span>+1 Clone</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* VIEW 4: USIMAMIZI WA KATEGORIA */}
        {activeSection === 'categories' && (
          <section className="bg-white border border-slate-100 rounded-lg shadow-sm p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="text-xs font-bold text-slate-900">
                {isSw ? 'Sajili ya Kategoria & ImageKit' : 'Category Registry & ImageKit Paths'}
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setShowCategoryModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isSw ? 'Ongeza Kategoria' : 'Add Category'}</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Code</th>
                    <th className="py-2.5 px-3">{isSw ? 'Jina (SW)' : 'Swahili Name'}</th>
                    <th className="py-2.5 px-3">{isSw ? 'Jina (EN)' : 'English Name'}</th>
                    <th className="py-2.5 px-3">ImageKit Folder</th>
                    <th className="py-2.5 px-3 text-right">{isSw ? 'Bidhaa' : 'SKUs'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {categories.map((cat) => {
                    const skuCount = catalogEntries.filter(
                      (e) => e.categoryCode === cat.categoryCode
                    ).length;
                    return (
                      <tr key={cat.categoryId} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {formatCodeWithoutUnderscores(cat.categoryCode)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800 font-medium">{cat.nameSw}</td>
                        <td className="py-2.5 px-3 text-slate-600">{cat.nameEn}</td>
                        <td className="py-2.5 px-3 font-mono text-emerald-700">
                          {cat.imagekitFolderPath}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                          {skuCount}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* VIEW 4A: CENTRALIZED UNITS & STANDARD PRICING ENGINE */}
        {activeSection === 'units' && <AdminUnitsAndPricingPanel locale={locale} />}

        {/* VIEW 5: ARCHITECTURE VAULT */}
        {activeSection === 'vault' && (
          <div className="space-y-5">
            <div className="border border-slate-200 bg-white rounded-lg p-3 flex flex-wrap gap-1.5">
              {ADMIN_DOC_MODULES.map(({ key, icon: Icon }) => {
                const isSelected = selectedDocModule === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDocModule(key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{t.nav[key]}</span>
                  </button>
                );
              })}
            </div>

            {selectedDocModule === 'database' && (
              <>
                <ManagedOrderInterceptorPanel locale={locale} />
                <TieredPricingSimulator locale={locale} />
              </>
            )}
            {selectedDocModule === 'security' && <RbacMatrixPanel locale={locale} />}
            {selectedDocModule === 'nextsms' && <NextSmsPayloadSimulator locale={locale} />}
            {selectedDocModule === 'reconciliation' && <DualPinReconciliationSimulator locale={locale} />}
            {selectedDocModule === 'eod' && <WholesalerEodReconciliation locale={locale} />}
            {selectedDocModule === 'optimization' && <OptimizationLabPanel locale={locale} />}
            {selectedDocModule === 'hybrid' && <HybridStorefrontPanel locale={locale} />}
            {selectedDocModule === 'pricing_router' && <DynamicPricingRouterPanel locale={locale} />}
            {selectedDocModule === 'analytics' && <HybridAnalyticsDashboard locale={locale} />}
            {selectedDocModule === 'qa_export' && <ConcurrencySmsCsvPanel locale={locale} />}
            {selectedDocModule === 'devops' && <DevOpsRetentionPanel locale={locale} />}
            {selectedDocModule === 'pwa' && <OfflineQueueSimulator locale={locale} />}

            <div className="space-y-5">
              {moduleArtifacts.map((artifact) => (
                <CodeViewer key={artifact.id} artifact={artifact} locale={locale} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: CREATE CATEGORY */}
      {showCategoryModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                {isSw ? 'Ongeza Kategoria Mpya' : 'New System Category'}
              </h3>
              <button
                type="button"
                onClick={() => setShowCategoryModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="p-5 space-y-4">
              {modalError && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs font-medium text-red-900">
                  {modalError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Msimbo (Code)' : 'Category Code'}
                  </label>
                  <input
                    type="text"
                    value={newCategoryCode}
                    onChange={(e) => setNewCategoryCode(e.target.value)}
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">ImageKit Folder</label>
                  <input
                    type="text"
                    value={newImagekitFolder}
                    onChange={(e) => setNewImagekitFolder(e.target.value)}
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Jina (SW)' : 'Name (Swahili)'}
                  </label>
                  <input
                    type="text"
                    value={newCategoryNameSw}
                    onChange={(e) => setNewCategoryNameSw(e.target.value)}
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
                    value={newCategoryNameEn}
                    onChange={(e) => setNewCategoryNameEn(e.target.value)}
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCategoryModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {isSw ? 'Ghairi' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
                >
                  {isSw ? 'Hifadhi Kategoria' : 'Save Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD CANONICAL PRODUCT + IMAGEKIT ASSET */}
      {showProductModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {isSw ? 'Ongeza Bidhaa Kuu (ImageKit)' : 'Add Canonical Item (ImageKit)'}
                </h3>
                <div className="text-[11px] font-mono text-slate-500">
                  /api/v1/admin/marketplace/catalog/add-item
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowProductModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleIngestCatalogProduct} className="p-5 space-y-4">
              {modalError && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs font-medium text-red-900">
                  {modalError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">SKU</label>
                  <input
                    type="text"
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Kategoria' : 'Category'}
                  </label>
                  <select
                    value={selectedCategoryCode}
                    onChange={(e) => setSelectedCategoryCode(e.target.value)}
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900 bg-white"
                  >
                    {categories.map((cat) => (
                      <option key={cat.categoryId} value={cat.categoryCode}>
                        {isSw ? cat.nameSw : cat.nameEn}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Jina (Kiswahili)' : 'Name (Swahili)'}
                </label>
                <input
                  type="text"
                  value={newProductNameSw}
                  onChange={(e) => setNewProductNameSw(e.target.value)}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  {isSw ? 'Jina (Kiingereza)' : 'Name (English)'}
                </label>
                <input
                  type="text"
                  value={newProductNameEn}
                  onChange={(e) => setNewProductNameEn(e.target.value)}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  ImageKit Endpoint URL
                </label>
                <div className="flex items-center gap-3">
                  <CatalogThumbnail
                    srcUrl={newImagekitUrlOverride}
                    alt={newProductNameEn || newSku}
                    sizeClass="w-12 h-12"
                  />
                  <input
                    type="url"
                    value={newImagekitUrlOverride}
                    onChange={(e) => setNewImagekitUrlOverride(e.target.value)}
                    placeholder="https://ik.imagekit.io/sokokuutz/tr:w-320,h-320,fo-auto,f-webp,q-80/..."
                    className="flex-1 min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {isSw ? 'Ghairi' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                >
                  <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSw ? 'Sajili Bidhaa' : 'Add Item'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
