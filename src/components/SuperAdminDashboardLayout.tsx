import { useCallback, useEffect, useState } from 'react';
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
  Pencil,
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
import {
  SokoApiClient,
  SokoHttpError,
  isSokoNetworkError,
} from '../services/sokoApiClient';
import {
  ADMIN_ALERT_CHANNEL_NAME,
  formatCodeWithoutUnderscores,
  type CatalogCategoryRecord,
  type GlobalCatalogEntry,
  type OrderDispatchAuditTrace,
} from '../lib/sokoManagedState';
import type { FocusOrderTarget } from '../lib/sokoFocusOrder';
import { AdminAlertTerminal } from './AdminAlertTerminal';
import { AdminMerchantsDirectoryPanel } from './AdminMerchantsDirectoryPanel';
import { AdminUnitsAndPricingPanel } from './AdminUnitsAndPricingPanel';
import { BackendOfflineBanner, EmptyStateCard } from './DatabaseStateBanner';
import { BrandLogo } from './BrandLogo';
import { CodeViewer } from './CodeViewer';
import { ConcurrencySmsCsvPanel } from './ConcurrencySmsCsvPanel';
import { DevOpsRetentionPanel } from './DevOpsRetentionPanel';
import { DynamicPricingRouterPanel } from './DynamicPricingRouterPanel';
import { HybridAnalyticsDashboard } from './HybridAnalyticsDashboard';
import { HybridStorefrontPanel } from './HybridStorefrontPanel';
import { ImageKitUpload } from './ImageKitUpload';
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
  | 'merchants'
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

const IMAGEKIT_CDN_REGEX = /^https:\/\/ik\.imagekit\.io\/[a-zA-Z0-9_-]+\/.+$/;

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
  focusOrder,
}: {
  locale?: Locale;
  authority: string;
  mobileSidebarOpen?: boolean;
  onMobileSidebarOpenChange?: (open: boolean) => void;
  focusOrder?: FocusOrderTarget | null;
}) {
  const isSw = locale === 'sw';
  const t = TRANSLATIONS[locale];

  const [activeSection, setActiveSection] = useState<AdminSectionKey>('metrics');
  useEffect(() => {
    if (focusOrder?.orderRef || focusOrder?.orderId) {
      setActiveSection('alarms');
    }
  }, [focusOrder]);
  const [internalMobileOpen, setInternalMobileOpen] = useState<boolean>(false);
  const mobileSidebarOpen = controlledMobileOpen ?? internalMobileOpen;
  const setMobileSidebarOpen = (open: boolean) => {
    setInternalMobileOpen(open);
    onMobileSidebarOpenChange?.(open);
  };
  const [selectedDocModule, setSelectedDocModule] = useState<AdminModuleKey>('admin_security');

  const [catalogEntries, setCatalogEntries] = useState<GlobalCatalogEntry[]>([]);
  const [categories, setCategories] = useState<CatalogCategoryRecord[]>([]);
  const [platformMetrics, setPlatformMetrics] = useState<{
    totalMerchants: number;
    managedMerchants: number;
    geoEnabledMerchants: number;
    totalUsers: number;
    totalCatalogEntries: number;
    totalActiveProducts: number;
    totalOrders: number;
    pendingDispatchedTraces: number;
    disputedLedgers: number;
    totalLeads: number;
    convertedLeads: number;
    pendingOutboxEvents: number;
    deadLetterOutboxEvents: number;
    smsSentCount: number;
  } | null>(null);
  const [managedAlarmCount, setManagedAlarmCount] = useState<number>(0);
  const [liveIncomingAlarms, setLiveIncomingAlarms] = useState<number>(0);
  const [backendOffline, setBackendOffline] = useState<boolean>(false);
  const [adminApiError, setAdminApiError] = useState<string | null>(null);
  const [adminDocs, setAdminDocs] = useState<{
    vaultName: string;
    masterSourceReference: string;
    masterChecksumSha256: string;
    totalArtifacts: number;
    implementationStatus: string;
    databaseCluster: string;
    timestampEat: string;
  } | null>(null);
  const [selectedPricingCatalogId, setSelectedPricingCatalogId] = useState<string | undefined>(
    undefined
  );

  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [adminToast, setAdminToast] = useState<string | null>(null);

  // Action Modals
  const [showCategoryModal, setShowCategoryModal] = useState<boolean>(false);
  const [showProductModal, setShowProductModal] = useState<boolean>(false);
  const [showEditCatalogModal, setShowEditCatalogModal] = useState<boolean>(false);
  const [editingCatalogEntry, setEditingCatalogEntry] = useState<GlobalCatalogEntry | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isSubmittingModal, setIsSubmittingModal] = useState<boolean>(false);

  // Category Form State (empty defaults)
  const [newCategoryCode, setNewCategoryCode] = useState<string>('');
  const [newCategoryNameSw, setNewCategoryNameSw] = useState<string>('');
  const [newCategoryNameEn, setNewCategoryNameEn] = useState<string>('');
  const [newImagekitFolder, setNewImagekitFolder] = useState<string>('');

  // Product Form State (empty defaults)
  const [newSku, setNewSku] = useState<string>('');
  const [newProductNameSw, setNewProductNameSw] = useState<string>('');
  const [newProductNameEn, setNewProductNameEn] = useState<string>('');
  const [selectedCategoryCode, setSelectedCategoryCode] = useState<string>('');
  const [newImagekitUrlOverride, setNewImagekitUrlOverride] = useState<string>('');
  // Reuse / clone an existing standard catalog instead of rebuilding a product.
  const [cloneSourceCatalogId, setCloneSourceCatalogId] = useState<string>('');

  // Admin-only global catalog edit form. Only the super admin console renders this.
  const [editNameSw, setEditNameSw] = useState<string>('');
  const [editNameEn, setEditNameEn] = useState<string>('');
  const [editCategoryCode, setEditCategoryCode] = useState<string>('');
  const [editImagekitUrl, setEditImagekitUrl] = useState<string>('');
  const [editBaseQuantumUnit, setEditBaseQuantumUnit] = useState<string>('');
  const [editIsActive, setEditIsActive] = useState<boolean>(true);

  const loadAdminOverviewFromApi = useCallback(async () => {
    try {
      const [metricsRes, catRows, catalogRows, managedRes] = await Promise.all([
        SokoApiClient.get<{
          totalMerchants: number;
          managedMerchants: number;
          geoEnabledMerchants: number;
          totalUsers: number;
          totalCatalogEntries: number;
          totalActiveProducts: number;
          totalOrders: number;
          pendingDispatchedTraces: number;
          disputedLedgers: number;
          totalLeads: number;
          convertedLeads: number;
          pendingOutboxEvents: number;
          deadLetterOutboxEvents: number;
          smsSentCount: number;
        }>('/admin/metrics'),
        SokoApiClient.get<
          Array<{
            id: string;
            categoryCode: string;
            nameSw: string;
            nameEn: string;
            imagekitFolderPath: string;
            createdAt: string;
          }>
        >('/admin/marketplace/catalog/categories'),
        SokoApiClient.get<
          Array<{
            id: string;
            canonicalSku: string;
            fixedNameSw: string;
            fixedNameEn: string;
            categoryCode: string;
            imagekitCdnUrl: string;
            staticImageUrl: string;
            baseQuantumUnit: string;
            isActive: boolean;
            clonedByStoresCount: number;
            updatedAt: string;
          }>
        >('/marketplace/catalog'),
        SokoApiClient.get<{
          count: number;
          traces: Array<{ helpdeskStatus: string }>;
        }>('/admin/managed-orders?routingOutputCode=ROUTED_PLATFORM_MANAGED_HELPDESK'),
      ]);

      setPlatformMetrics(metricsRes);

      const mappedCategories: CatalogCategoryRecord[] = (catRows || []).map((c) => ({
        categoryId: c.id,
        categoryCode: c.categoryCode,
        nameSw: c.nameSw,
        nameEn: c.nameEn,
        imagekitFolderPath: c.imagekitFolderPath,
        createdAtEat: new Date(c.createdAt).toLocaleDateString(),
      }));
      const categoryLabelMap = new Map(
        mappedCategories.map((c) => [c.categoryCode, isSw ? c.nameSw : c.nameEn])
      );

      const mappedCatalog: GlobalCatalogEntry[] = (catalogRows || []).map((item) => ({
        globalCatalogId: item.id,
        canonicalSku: item.canonicalSku,
        fixedNameSw: item.fixedNameSw,
        fixedNameEn: item.fixedNameEn,
        category: categoryLabelMap.get(item.categoryCode) ?? item.categoryCode,
        categoryCode: item.categoryCode,
        imagekitCdnUrl: item.imagekitCdnUrl,
        staticImageUrl: item.staticImageUrl,
        defaultBaseUnitSw: item.baseQuantumUnit || 'Quanta (Robo 250g/mL)',
        defaultBaseUnitEn: item.baseQuantumUnit || 'Quanta (250g/mL Base)',
        baseQuantumUnit: item.baseQuantumUnit || '',
        isActive: item.isActive,
        clonedByStoresCount: Number(item.clonedByStoresCount ?? 0),
        updatedAtEat: new Date(item.updatedAt).toLocaleDateString(),
      }));

      setCategories(mappedCategories);
      setCatalogEntries(mappedCatalog);
      if (
        mappedCategories.length > 0 &&
        !mappedCategories.some((c) => c.categoryCode === selectedCategoryCode)
      ) {
        setSelectedCategoryCode(mappedCategories[0].categoryCode);
      }
      const traces = managedRes?.traces ?? [];
      setManagedAlarmCount(traces.length);
      setLiveIncomingAlarms(traces.filter((t) => t.helpdeskStatus === 'OPEN').length);
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setPlatformMetrics(null);
        setCatalogEntries([]);
        setCategories([]);
        setManagedAlarmCount(0);
        setLiveIncomingAlarms(0);
      } else {
        setAdminApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia takwimu za mfumo.'
              : 'Failed to load admin workspace from NestJS.'
        );
      }
    }
  }, [isSw, selectedCategoryCode]);

  const loadAdminDocs = useCallback(async () => {
    if (!SokoApiClient.hasAccessToken()) return;
    setAdminApiError(null);
    try {
      const docs = await SokoApiClient.get<{
        vaultName: string;
        masterSourceReference: string;
        masterChecksumSha256: string;
        totalArtifacts: number;
        implementationStatus: string;
        databaseCluster: string;
        timestampEat: string;
      }>('/admin/docs/blueprints');
      setAdminDocs(docs);
      setBackendOffline(false);
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
      } else {
        setAdminApiError(
          err instanceof SokoHttpError
            ? err.message
            : isSw
              ? 'Imeshindikana kupakia hazina ya blueprints.'
              : 'Failed to load the architecture vault from NestJS.'
        );
      }
    }
  }, []);

  useEffect(() => {
    void loadAdminOverviewFromApi();
    void loadAdminDocs();

    const handleRefresh = () => {
      void loadAdminOverviewFromApi();
      void loadAdminDocs();
    };
    const handleLiveAlert = (evt: Event) => {
      const detail = (evt as CustomEvent<OrderDispatchAuditTrace>).detail;
      if (detail?.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK') {
        void loadAdminOverviewFromApi();
      }
    };

    window.addEventListener('sokokuu:catalog-updated', handleRefresh);
    window.addEventListener('sokokuu:orders-updated', handleRefresh);
    window.addEventListener('sokokuu:managed-order-alert', handleLiveAlert);

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      try {
        channel = new BroadcastChannel(ADMIN_ALERT_CHANNEL_NAME);
        channel.onmessage = (msg) => {
          const payload = msg.data as OrderDispatchAuditTrace | undefined;
          if (payload?.routingCode === 'ROUTED_PLATFORM_MANAGED_HELPDESK') {
            void loadAdminOverviewFromApi();
          }
        };
      } catch {
        // ignore BroadcastChannel errors
      }
    }

    return () => {
      window.removeEventListener('sokokuu:catalog-updated', handleRefresh);
      window.removeEventListener('sokokuu:orders-updated', handleRefresh);
      window.removeEventListener('sokokuu:managed-order-alert', handleLiveAlert);
      channel?.close();
    };
  }, [loadAdminOverviewFromApi, loadAdminDocs]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowCategoryModal(false);
        setShowProductModal(false);
        setShowEditCatalogModal(false);
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

  const handleInspectUnitsAndPrices = (entry: GlobalCatalogEntry) => {
    setSelectedPricingCatalogId(entry.globalCatalogId);
    setActiveSection('units');
  };

  /**
   * Reuse the immutable standard catalog data (names, category and ImageKit
   * CDN pointer) so the admin never has to recreate or re-upload a product.
   * Only a unique canonical SKU is required for the new catalog row.
   */
  const applyStandardCatalogClone = (entry: GlobalCatalogEntry) => {
    setModalError(null);
    setCloneSourceCatalogId(entry.globalCatalogId);
    setNewProductNameSw(entry.fixedNameSw);
    setNewProductNameEn(entry.fixedNameEn);
    setSelectedCategoryCode(entry.categoryCode);
    setNewImagekitUrlOverride(
      IMAGEKIT_CDN_REGEX.test(entry.imagekitCdnUrl) ? entry.imagekitCdnUrl : ''
    );
    setNewSku(`${entry.canonicalSku}-${Date.now().toString().slice(-5)}`);
    setShowProductModal(true);
  };

  const openEditCatalogModal = (entry: GlobalCatalogEntry) => {
    setModalError(null);
    setEditingCatalogEntry(entry);
    setEditNameSw(entry.fixedNameSw);
    setEditNameEn(entry.fixedNameEn);
    setEditCategoryCode(entry.categoryCode);
    setEditImagekitUrl(
      IMAGEKIT_CDN_REGEX.test(entry.imagekitCdnUrl) ? entry.imagekitCdnUrl : ''
    );
    setEditBaseQuantumUnit(entry.baseQuantumUnit ?? '');
    setEditIsActive(entry.isActive ?? true);
    setShowEditCatalogModal(true);
  };

  const handleUpdateCatalogItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    if (!editingCatalogEntry) return;

    const cdnUrl = editImagekitUrl.trim();
    if (!editNameSw.trim() || !editNameEn.trim() || !editCategoryCode || !cdnUrl) {
      setModalError(
        isSw
          ? 'Jaza majina, kategoria na picha halali ya ImageKit.'
          : 'Names, category and a valid ImageKit image are required.'
      );
      return;
    }
    if (!IMAGEKIT_CDN_REGEX.test(cdnUrl)) {
      setModalError(
        isSw
          ? 'URL lazima iwe anuani halisi ya ImageKit CDN (https://ik.imagekit.io/...).'
          : 'Asset URL must be an absolute ImageKit.io CDN pointer (https://ik.imagekit.io/...).'
      );
      return;
    }

    setIsSubmittingModal(true);
    try {
      await SokoApiClient.patch(
        `/admin/marketplace/catalog/${editingCatalogEntry.globalCatalogId}`,
        {
          fixedNameSw: editNameSw.trim(),
          fixedNameEn: editNameEn.trim(),
          categoryCode: editCategoryCode.trim().toUpperCase(),
          imagekitCdnUrl: cdnUrl,
          baseQuantumUnit: editBaseQuantumUnit.trim() || undefined,
          isActive: editIsActive,
        }
      );

      await loadAdminOverviewFromApi();
      setShowEditCatalogModal(false);
      setEditingCatalogEntry(null);
      setAdminToast(
        isSw
          ? `${editingCatalogEntry.canonicalSku} imehaririwa kwenye Global Catalog (admin pekee).`
          : `${editingCatalogEntry.canonicalSku} updated in Global Catalog (admin only).`
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setModalError(
          isSw
            ? 'Hakuna muunganisho kwa sasa. Jaribu tena baadaye.'
            : 'Offline right now. Try again when connected.'
        );
      } else {
        setModalError(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to update catalog item.'
        );
      }
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
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

    const cleanFolder = newImagekitFolder.trim().startsWith('/')
      ? newImagekitFolder.trim()
      : `/${newImagekitFolder.trim()}`;

    setIsSubmittingModal(true);
    try {
      await SokoApiClient.post('/admin/marketplace/catalog/categories', {
        categoryCode: cleanCode,
        nameSw: newCategoryNameSw.trim(),
        nameEn: newCategoryNameEn.trim(),
        imagekitFolderPath: cleanFolder,
      });

      await loadAdminOverviewFromApi();
      setSelectedCategoryCode(cleanCode);
      setNewCategoryCode('');
      setNewCategoryNameSw('');
      setNewCategoryNameEn('');
      setNewImagekitFolder('');
      setShowCategoryModal(false);
      setAdminToast(
        isSw
          ? `Kategoria "${newCategoryNameSw.trim()}" imehifadhiwa kwenye PostgreSQL.`
          : `Category "${newCategoryNameEn.trim()}" persisted to PostgreSQL.`
      );
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setModalError(
          isSw
            ? 'Hakuna muunganisho kwa sasa. Jaribu tena baadaye.'
            : 'Offline right now. Try again when connected.'
        );
      } else {
        setModalError(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to create catalog category.'
        );
      }
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const handleIngestCatalogProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    const sku = newSku.trim().toUpperCase();
    const cdnUrl = newImagekitUrlOverride.trim();

    if (!sku || !newProductNameSw.trim() || !newProductNameEn.trim() || !selectedCategoryCode) {
      setModalError(
        isSw ? 'Jaza SKU, kategoria, na majina rasmi.' : 'SKU, category, and canonical names are required.'
      );
      return;
    }

    if (!IMAGEKIT_CDN_REGEX.test(cdnUrl)) {
      setModalError(
        isSw
          ? 'URL lazima iwe anuani halisi ya ImageKit CDN (https://ik.imagekit.io/...).'
          : 'Asset URL must be an absolute ImageKit.io CDN pointer (https://ik.imagekit.io/...).'
      );
      return;
    }

    setIsSubmittingModal(true);
    try {
      await SokoApiClient.post('/admin/marketplace/catalog/add-item', {
        canonicalSku: sku,
        fixedNameSw: newProductNameSw.trim(),
        fixedNameEn: newProductNameEn.trim(),
        categoryCode: selectedCategoryCode,
        imagekitCdnUrl: cdnUrl,
      });

      await loadAdminOverviewFromApi();
      setShowProductModal(false);
      setNewSku('');
      setNewProductNameSw('');
      setNewProductNameEn('');
      setNewImagekitUrlOverride('');
      setCloneSourceCatalogId('');
      setAdminToast(
        isSw
          ? `${sku} imeongezwa.`
          : `${sku} added.`
      );
      setActiveSection('catalog');
    } catch (err) {
      if (isSokoNetworkError(err)) {
        setBackendOffline(true);
        setModalError(
          isSw
            ? 'Hakuna muunganisho kwa sasa. Jaribu tena baadaye.'
            : 'Offline right now. Try again when connected.'
        );
      } else {
        setModalError(
          err instanceof SokoHttpError
            ? `HTTP ${err.status}: ${err.message}`
            : 'Failed to ingest catalog item.'
        );
      }
    } finally {
      setIsSubmittingModal(false);
    }
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
      labelSw: 'Vipimo vya Mfumo',
      labelEn: 'System Metrics',
      metaSw: 'Live DB Telemetry',
      metaEn: 'Live PostgreSQL Counts',
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
      key: 'merchants',
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
      metaSw: 'Geolocation · SMS PIN4',
      metaEn: 'Geolocation · SMS PIN4',
      icon: MapPin,
    },
    {
      key: 'catalog',
      labelSw: 'Global Catalog Manager',
      labelEn: 'Global Catalog Manager',
      metaSw: `${catalogEntries.length} Bidhaa`,
      metaEn: `${catalogEntries.length} SKUs`,
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
          ik.imagekit.io/ochspoiwa/sokokuutz/
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
                setCloneSourceCatalogId('');
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

        {backendOffline && (
          <BackendOfflineBanner
            locale={locale}
            onRetry={() => {
              void loadAdminOverviewFromApi();
              void loadAdminDocs();
            }}
          />
        )}

        {adminApiError && (
          <div
            role="alert"
            className="border border-red-200 bg-red-50 rounded-lg p-3.5 text-xs text-red-900 flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-2">
              <Lock className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{adminApiError}</span>
            </div>
            <button
              type="button"
              onClick={() => setAdminApiError(null)}
              className="text-red-700 hover:text-red-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* VIEW 1: SYSTEM METRICS (LIVE POSTGRESQL COUNTS) */}
        {activeSection === 'metrics' && (
          <div className="space-y-5">
            <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-white border border-slate-100 rounded-lg shadow-sm divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
              <div className="p-4 space-y-1">
                <div className="text-xs text-slate-500">
                  {isSw ? 'Wafanyabiashara (Merchants)' : 'Verified Merchants'}
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-600">
                  {platformMetrics ? platformMetrics.totalMerchants.toLocaleString('en-US') : '—'}
                </div>
                <div className="text-xs font-mono text-slate-500">
                  {platformMetrics
                    ? `${platformMetrics.managedMerchants} Helpdesk · ${platformMetrics.geoEnabledMerchants} GIS`
                    : 'PostgreSQL /api/v1/admin/metrics'}
                </div>
              </div>
              <div className="p-4 space-y-1">
                <div className="text-xs text-slate-500">
                  {isSw ? 'Oda & Bidhaa Hai' : 'Orders & Active SKUs'}
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
                  {platformMetrics
                    ? `${platformMetrics.totalOrders.toLocaleString('en-US')} / ${platformMetrics.totalActiveProducts.toLocaleString('en-US')}`
                    : '—'}
                </div>
                <div className="text-xs font-mono text-slate-500">
                  {platformMetrics
                    ? `${platformMetrics.totalUsers} Users · ${platformMetrics.convertedLeads}/${platformMetrics.totalLeads} Leads`
                    : 'PostgreSQL Live Counts'}
                </div>
              </div>
              <div className="p-4 space-y-1">
                <div className="text-xs text-slate-500">
                  {isSw ? 'Kengele za Oda & Outbox' : 'STOMP Alarms & Outbox'}
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-emerald-600">
                  {managedAlarmCount}{' '}
                  {liveIncomingAlarms > 0 && (
                    <span className="text-xs text-amber-700">(+{liveIncomingAlarms})</span>
                  )}
                </div>
                <div className="text-xs font-mono text-slate-500">
                  {platformMetrics
                    ? `Outbox: ${platformMetrics.pendingOutboxEvents} pending · ${platformMetrics.deadLetterOutboxEvents} DLQ`
                    : '/topic/admin/managed-alerts'}
                </div>
              </div>
              <div className="p-4 space-y-1">
                <div className="text-xs text-slate-500">
                  {isSw ? 'Matumizi ya Wafanyabiashara & SMS' : 'Merchant Adoptions & SMS'}
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
                  {totalStoreAdoptions.toLocaleString('en-US')}
                </div>
                <div className="text-xs font-mono text-slate-500">
                  {platformMetrics
                    ? `SMS: ${platformMetrics.smsSentCount} · Disputes: ${platformMetrics.disputedLedgers}`
                    : `Wafanyabiashara: ${totalStoreAdoptions}`}
                </div>
              </div>
            </section>

            <OptimizationLabPanel locale={locale} />
            <DevOpsRetentionPanel locale={locale} />
          </div>
        )}

        {/* VIEW 2: LIVE ADMIN-ONLY ORDERS */}
        {activeSection === 'alarms' && (
          <AdminAlertTerminal locale={locale} focusOrder={focusOrder} />
        )}

        {/* VIEW 2A: REGISTERED MERCHANTS LIST & SETTINGS */}
        {activeSection === 'merchants' && <AdminMerchantsDirectoryPanel locale={locale} />}

        {/* VIEW 2B: FULL-PAGE PROXIMITY MAP MATRIX */}
        {activeSection === 'map_matrix' && (
          <FullPageMarketplaceMap
            locale={locale}
            authority="SUPER_ADMIN"
            onOpenMerchantsSettings={() => setActiveSection('merchants')}
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
              <EmptyStateCard
                locale={locale}
                titleSw="Hakuna bidhaa kwenye Global Catalog"
                titleEn="No catalog items yet"
                descriptionSw="Ongeza bidhaa kuu au hakikisha hifadhidata ya PostgreSQL ina rekodi."
                descriptionEn="Add a canonical SKU or check PostgreSQL catalog records."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">{isSw ? 'Bidhaa & Picha' : 'Product & Image'}</th>
                      <th className="py-2.5 px-3">{isSw ? 'Kategoria' : 'Category'}</th>
                      <th className="py-2.5 px-3 text-right">{isSw ? 'Takwimu za Wafanyabiashara' : 'Merchant Adoption'}</th>
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
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-200 bg-emerald-50 font-mono text-xs font-bold text-emerald-800 tabular-nums">
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                            <span>
                              Inatumiwa na Wafanyabiashara: {entry.clonedByStoresCount.toLocaleString('en-US')}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => applyStandardCatalogClone(entry)}
                              title={isSw ? 'Tumia tena bidhaa sanifu' : 'Reuse / clone standard catalog'}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{isSw ? 'Tumia Tena' : 'Clone / Reuse'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditCatalogModal(entry)}
                              title={isSw ? 'Hariri bidhaa sanifu (admin pekee)' : 'Edit canonical item (admin only)'}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-amber-50 hover:border-amber-300 text-slate-700 hover:text-amber-900 text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                              <span>{isSw ? 'Hariri' : 'Edit'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleInspectUnitsAndPrices(entry)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 hover:text-emerald-900 text-xs font-semibold transition-colors cursor-pointer"
                            >
                              <Scale className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                              <span>{isSw ? 'Vipimo & Bei' : 'Units & Pricing'}</span>
                            </button>
                          </div>
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

            {categories.length === 0 ? (
              <EmptyStateCard
                locale={locale}
                titleSw="Hakuna kategoria bado"
                titleEn="No categories registered yet"
                descriptionSw="Sajili kategoria ya ImageKit kuhifadhi bidhaa kwenye PostgreSQL."
                descriptionEn="Register a catalog category in PostgreSQL to organize SKUs."
              />
            ) : (
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
            )}
          </section>
        )}

        {/* VIEW 4A: CENTRALIZED UNITS & STANDARD PRICING ENGINE */}
        {activeSection === 'units' && (
          <AdminUnitsAndPricingPanel
            locale={locale}
            initialCatalogId={selectedPricingCatalogId}
          />
        )}

        {/* VIEW 5: ARCHITECTURE VAULT */}
        {activeSection === 'vault' && (
          <div className="space-y-5">
            <section className="border border-emerald-200 bg-emerald-50/50 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-950">
                <FileCode2 className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                <span>
                  {adminDocs?.vaultName ??
                    (isSw ? 'Hazina ya Blueprints (NestJS)' : 'Live Blueprint Vault (NestJS)')}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 text-[11px]">
                <div className="font-mono text-slate-700">
                  {isSw ? 'Chanzo' : 'Source'}: {adminDocs?.masterSourceReference ?? '—'}
                </div>
                <div className="font-mono text-slate-700">
                  {isSw ? 'Vipengele' : 'Artifacts'}: {adminDocs?.totalArtifacts ?? CODE_ARTIFACTS.length}
                </div>
                <div className="font-mono text-slate-700">
                  {isSw ? 'Hali' : 'Status'}: {adminDocs?.implementationStatus ?? '—'}
                </div>
                <div className="font-mono text-slate-700 break-all">
                  SHA-256: {adminDocs?.masterChecksumSha256 ?? '—'}
                </div>
              </div>
              {adminDocs?.timestampEat && (
                <div className="text-[11px] font-mono text-slate-500">
                  {isSw ? 'Imefikiwa' : 'Accessed'}: {adminDocs.timestampEat}
                </div>
              )}
            </section>

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
                    placeholder="NAFAKA_UNGA"
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
                    placeholder="/sokokuutz/catalog/..."
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
                    placeholder={isSw ? 'Jina la Kiswahili' : 'Swahili name'}
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
                    placeholder={isSw ? 'Jina la Kiingereza' : 'English name'}
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
                  disabled={isSubmittingModal}
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isSw ? 'Hifadhi Kategoria' : 'Save Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: REUSE / CLONE A STANDARD CATALOG OR ADD A CANONICAL ITEM */}
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
                  {isSw
                    ? 'Tumia Tena / Nakili Bidhaa Sanifu'
                    : 'Reuse / Clone Standard Catalog'}
                </h3>
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

              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
                <div className="flex items-center gap-2 text-emerald-900">
                  <Copy className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  <span className="text-xs font-bold">
                    {isSw
                      ? 'Tumia tena / Nakili kutoka Catalog Sanifu'
                      : 'Reuse / clone from a standard catalog'}
                  </span>
                </div>
                <p className="text-[11px] text-emerald-900/80">
                  {isSw
                    ? 'Chagua bidhaa sanifu iliyopo; majina, kategoria na picha ya ImageKit vitajazwa kiotomatiki — hutahitaji kuunda bidhaa upya.'
                    : 'Pick an existing standard SKU; names, category and its ImageKit image are filled in automatically — no need to recreate the product.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={cloneSourceCatalogId}
                    onChange={(e) => setCloneSourceCatalogId(e.target.value)}
                    className="min-h-[36px] px-2.5 rounded-lg border border-emerald-200 bg-white text-xs text-slate-900 max-w-full"
                  >
                    <option value="">
                      {isSw ? 'Chagua bidhaa sanifu...' : 'Select standard catalog...'}
                    </option>
                    {catalogEntries.map((entry) => (
                      <option key={entry.globalCatalogId} value={entry.globalCatalogId}>
                        {entry.canonicalSku} — {isSw ? entry.fixedNameSw : entry.fixedNameEn}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!cloneSourceCatalogId}
                    onClick={() => {
                      const source = catalogEntries.find(
                        (c) => c.globalCatalogId === cloneSourceCatalogId
                      );
                      if (source) applyStandardCatalogClone(source);
                    }}
                    className="min-h-[36px] px-3 rounded-lg border border-emerald-300 bg-white text-xs font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer disabled:opacity-50"
                  >
                    {isSw ? 'Tumia Catalog Hiyo' : 'Use This Catalog'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">SKU</label>
                  <input
                    type="text"
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    placeholder="GC-SKU-001"
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
                  placeholder={isSw ? 'Jina la bidhaa kwa Kiswahili' : 'Product name in Swahili'}
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
                  placeholder={isSw ? 'Jina la bidhaa kwa Kiingereza' : 'Product name in English'}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <ImageKitUpload
                  locale={locale}
                  label={isSw ? 'Picha ya Bidhaa (ImageKit)' : 'Product Image'}
                  folder="/sokokuu/catalog"
                  value={newImagekitUrlOverride}
                  onChange={setNewImagekitUrlOverride}
                />
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
                  disabled={isSubmittingModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSw ? 'Sajili Bidhaa' : 'Add Item'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ADMIN-ONLY EDIT OF AN EXISTING GLOBAL CATALOG ITEM */}
      {showEditCatalogModal && editingCatalogEntry && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {isSw ? 'Hariri Bidhaa Sanifu (Admin Pekee)' : 'Edit Canonical Item (Admin Only)'}
                </h3>
                <div className="text-[11px] font-mono text-slate-500">
                  PATCH /api/v1/admin/marketplace/catalog/{editingCatalogEntry.globalCatalogId}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEditCatalogModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateCatalogItem} className="p-5 space-y-4">
              {modalError && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs font-medium text-red-900">
                  {modalError}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="font-mono text-xs font-bold text-slate-900">
                  {editingCatalogEntry.canonicalSku}
                </div>
                <div className="text-[11px] text-slate-600">
                  {isSw
                    ? 'Mabadiliko yote yanasasisha soko kuu la PostgreSQL.'
                    : 'All changes update the canonical PostgreSQL catalog.'}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Jina (Kiswahili)' : 'Name (Swahili)'}
                  </label>
                  <input
                    type="text"
                    value={editNameSw}
                    onChange={(e) => setEditNameSw(e.target.value)}
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
                    value={editNameEn}
                    onChange={(e) => setEditNameEn(e.target.value)}
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs text-slate-900"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Kategoria' : 'Category'}
                  </label>
                  <select
                    value={editCategoryCode}
                    onChange={(e) => setEditCategoryCode(e.target.value)}
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs text-slate-900"
                  >
                    {categories.map((cat) => (
                      <option key={cat.categoryId} value={cat.categoryCode}>
                        {isSw ? cat.nameSw : cat.nameEn}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    {isSw ? 'Kipimo cha Msingi' : 'Base Quantum Unit'}
                  </label>
                  <input
                    type="text"
                    value={editBaseQuantumUnit}
                    onChange={(e) => setEditBaseQuantumUnit(e.target.value)}
                    placeholder="QUANTA 250G"
                    className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-mono text-slate-900"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <ImageKitUpload
                  locale={locale}
                  label={isSw ? 'Picha ya Bidhaa (ImageKit)' : 'Product Image'}
                  folder="/sokokuu/catalog"
                  value={editImagekitUrl}
                  onChange={setEditImagekitUrl}
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600"
                />
                {isSw ? 'Bidhaa iko hai kwenye soko' : 'Item is active in the marketplace'}
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowEditCatalogModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {isSw ? 'Ghairi' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingModal}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSw ? 'Hifadhi Mabadiliko' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
