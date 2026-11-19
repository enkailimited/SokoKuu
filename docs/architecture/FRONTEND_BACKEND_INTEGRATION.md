# Frontend-to-Backend Integration Contract Audit

This document catalogs every client-side storage mechanism (`localStorage`, `IndexedDB`, `BroadcastChannel`, `CacheStorage`), REST endpoint, and real-time STOMP subscription present in the React/Vite PWA (`src/**`, `public/sw.js`) and maps each to its exact authoritative NestJS backend contract.

---

## 1. Frontend Client Storage Audit (`localStorage` & `IndexedDB`)

### 1.1 `localStorage` Keys Audited

| File | Key | Purpose in Current PWA | Target Backend Persistence / Sync Strategy |
| :--- | :--- | :--- | :--- |
| `src/App.tsx` | `sokokuu_active_role_v1` | Active persona session state | Replace demo switcher with JWT Access/Refresh tokens (`httpOnly` cookie / memory access token) + `GET /api/v1/auth/me` |
| `src/App.tsx` | `sokokuu_accounts_v1` | Editable profile overrides (`fullName`, `ward`, `pinCode`) | `GET/PATCH /api/v1/users/me` (`users` + `business_profiles`) |
| `src/App.tsx` | `sokokuu_locale_v1` | Active language (`en` / `sw`) | Keep as UI preference + sync to `users.preferred_locale` |
| `src/hooks/useSokoKuuI18n.ts` | `sokokuu_offline_locale` | Zero-network bilingual dictionary cache | Keep as offline UI preference cache |
| `src/App.tsx` | `sokokuu_retailer_tab_v1` | Last active retailer tab | Keep as local UI state |
| `src/context/DataSaverContext.tsx` | `sokokuu_low_data_mode` | Low-data ImageKit compression toggle | Keep as local UI preference |
| `src/context/HybridModeContext.tsx` | `sokokuu_hybrid_view_channel` | Hybrid storefront `WHOLESALE` vs `RETAIL` view toggle | Keep as local UI preference + query param `?channel=` |
| `src/lib/sokoManagedState.ts` | `sokokuu_managed_wholesalers_v1` | Wholesale hub directory & `isPlatformManaged` toggle state | `GET /api/v1/admin/wholesalers` & `PATCH /api/v1/admin/wholesalers/:businessId/managed` |
| `src/lib/sokoManagedState.ts` | `sokokuu_dispatch_audit_traces_v1` | Audit traces (`ROUTED_PLATFORM_MANAGED_HELPDESK` vs `ROUTED_DIRECT_MERCHANT_DB`) | `GET /api/v1/admin/audit/dispatch-traces` & `POST /api/v1/marketplace/orders/submit-request` |
| `src/lib/sokoManagedState.ts` | `sokokuu_global_catalog_v2` | Master catalog (`soko_global_catalog`) & `clonedByStoresCount` | `GET /api/v1/marketplace/catalog` & `POST /api/v1/admin/marketplace/catalog/add-item` |
| `src/lib/sokoManagedState.ts` | `sokokuu_catalog_categories_v1` | Master categories (`soko_catalog_categories`) | `GET /api/v1/marketplace/categories` & `POST /api/v1/admin/marketplace/catalog/categories` |
| `src/lib/sokoManagedState.ts` | `sokokuu_tenant_geospatial_perms_v1` | Per-tenant `geospatial_map_enabled` flags (default `false`) | `GET /api/v1/geospatial/stores-map-matrix` & `POST /api/v1/admin/tenant/toggle-map` |
| `src/components/SalesLeadsDashboard.tsx` | `sokokuu_sales_leads_v1` | Field leads + GPS + optimistic `version` | `GET /api/v1/sales/leads` & `POST /api/v1/sales/leads/:leadId/convert` |
| `src/services/webPushRegistrationService.ts` | `sokokuu:webpush:${userId}` | Local receipt marker after VAPID subscription | `POST /api/v1/notifications/push/subscribe` (`web_push_subscriptions`) |

### 1.2 `IndexedDB` Databases & Service Worker Cache (`public/sw.js`)

| Database / Cache | Source File | Offline Store & KeyPath | Target NestJS Sync Endpoint |
| :--- | :--- | :--- | :--- |
| `sokokuu_tz_cod_demo` | `src/lib/indexedDbDemo.ts` | `offline_orders` (`idempotencyKey`) | `POST /api/v1/orders/request` (idempotency header) or `POST /api/v1/callback/nextsms/incoming` |
| `sokokuu_duka_shelf_db` | `src/components/DukaShelfTerminal.tsx` | `shelf_inventory` (`itemId`) | `GET /api/v1/retailer/inventory` & `POST /api/v1/retailer/pos/sales-receipt` |
| `sokokuu_inventory_units_db` | `src/components/InventoryAndUnitManager.tsx` | `shelf_items` (`itemId`) | `GET /api/v1/retailer/inventory`, `POST /api/v1/marketplace/catalog/clone-standard` |
| `sokokuu_hybrid_catalog_cache` | `src/components/HybridStorefrontPanel.tsx` | `catalog_items` (`id`, index `by-channel`) | `GET /api/v1/products/active?businessId=X` |
| `sokokuu_dynamic_pricing_cache` | `src/hooks/useDynamicCartCalculator.ts` | `hybrid_price_sheets` (`productId`) | `POST /api/v1/pricing/calculate-cart` (preview), `POST /api/v1/orders/request` (checkout) |
| `sokokuu_global_clone_sync_db` | `src/lib/sokoManagedState.ts` | `pending_global_clones` (`globalCatalogId`) | `POST /api/v1/marketplace/catalog/clone/:globalCatalogId` |
| `sokokuu-shell-v7`, `sokokuu-static-v7`, `sokokuu-api-v7` | `public/sw.js` | Offline shell + 202 fallback for `/api/v1/retailer/inventory`, `/api/v1/pos*`, `/api/v1/marketplace/catalog/clone*` | NestJS returns `200/201`; SW catches network outage to stage offline `202` until reconnect |

### 1.3 Component Mock Seed Arrays Cataloged for Backend Replacement

- `src/types/auth.ts`: `SEED_PLATFORM_ACCOUNTS` (`CONSUMER`, `RETAILER`, `WHOLESALER`, `DRIVER`, `SUPER_ADMIN`).
- `src/components/SokoniDirectory.tsx`: `NEARBY_STORES`, `STORE_CATALOG_DB`.
- `src/components/SokoniCoreEngine.tsx`: `WHOLESALES`, `STORE_PRODUCTS_BY_ID`, `INITIAL_DISPATCHED_ORDERS`.
- `src/components/ConsumerDashboardView.tsx`: `NEIGHBORHOOD_DUKAS`, `DUKA_LOOSE_PRODUCTS`, `INITIAL_CONSUMER_ORDERS`.
- `src/components/WholesalerOperationsView.tsx`: `ACTIVE_RIDERS`.
- `src/components/WholesalerEodReconciliation.tsx`: `INITIAL_DRIVERS`.
- `src/components/MobileDriverReceiptCard.tsx`: `INITIAL_DRIVER_TASKS`.
- `src/components/HybridAnalyticsDashboard.tsx`: `INITIAL_LOW_STOCK_ITEMS`.
- `src/components/SmartStoreCatalog.tsx` / `SmartGridStoreCatalog.tsx`: `DEFAULT_INTELLIGENT_CATALOG` / `DEFAULT_SMART_GRID_PRODUCTS`.

---

## 2. REST Endpoint Contract Matrix (`/api/v1/**`)

| Method & Path | Frontend Consumer(s) | Required Role(s) | NestJS Controller & Method | Transaction / Guard Notes |
| :--- | :--- | :--- | :--- | :--- |
| `POST /api/v1/auth/login` | Auth Portal | Public (throttled) | `AuthController.login` | Argon2id check + JWT Access + Rotating Refresh |
| `POST /api/v1/auth/refresh` | Global Auth Client | Public (refresh token) | `AuthController.refresh` | Hash match in Redis/DB + reuse revocation |
| `POST /api/v1/auth/logout` | AppBar Profile Menu | Authenticated | `AuthController.logout` | Revokes refresh family + access JTI blacklist |
| `GET /api/v1/products/active?businessId=X` | `SokoniDirectory`, `SokoniCoreEngine`, `HybridStorefrontPanel` | `SUPER_ADMIN`, `WHOLESALER`, `RETAILER`, `CONSUMER` | `ProductCatalogController.getActiveProducts` | Strict `businessId` scope + `available_quanta > 0` |
| `GET /api/v1/sokoni/:wholesalerBusinessId/smart-grid?q=` | `SmartGridStoreCatalog`, `SmartStoreCatalog` | `RETAILER`, `WHOLESALER`, `SUPER_ADMIN` | `SmartGridController.getSmartGrid` | `REPEATABLE_READ`; flags low-stock in buyer's Duka |
| `POST /api/v1/orders/request` | `SokoniDirectory`, `SokoniCoreEngine`, `ConsumerDashboardView` | `SUPER_ADMIN`, `RETAILER`, `CONSUMER` | `OrdersController.submitIsolatedOrder` | Single-store rule; zero trust on client price |
| `POST /api/v1/marketplace/orders/submit-request` | `ManagedOrderInterceptorPanel`, `SokoniCoreEngine` | `RETAILER`, `CONSUMER`, `SUPER_ADMIN` | `MarketplaceController.submitManagedOrder` | `REPEATABLE_READ`; routes via `is_platform_managed` |
| `POST /api/v1/orders/:orderId/dispatch` | `WholesalerOperationsView` | `WHOLESALER`, `SUPER_ADMIN` | `DispatchController.dispatchOrder` | Allocates CSPRNG Buyer/Driver PINs + QR ledger |
| `POST /api/v1/retailer/pos/sales-receipt` | `InventoryAndUnitManager`, `DukaShelfTerminal`, `public/sw.js` | `RETAILER`, `SUPER_ADMIN` | `RetailerPosController.recordSale` | `FOR UPDATE` deduction; derive `businessId` from JWT |
| `POST /api/v1/orders/reconcile/retailer-qr-scan` | `IsolatedQrVerificationTerminal` | `RETAILER` | `IsolatedDoorstepController.notifyDriver` | Validates `SKQR-*`; emits WS `TRIGGER_DRIVER_PIN_MODAL_OPEN` after commit |
| `POST /api/v1/orders/reconcile/buyer-pin` | `IsolatedQrVerificationTerminal` | `RETAILER` | `IsolatedDoorstepController.submitBuyerPin` | `SERIALIZABLE` + `FOR UPDATE`; verifies Buyer PIN only |
| `POST /api/v1/orders/reconcile/driver-pin` | `IsolatedQrVerificationTerminal`, `MobileDriverReceiptCard` | `DRIVER` | `IsolatedDoorstepController.submitDriverPin` | `SERIALIZABLE` + `FOR UPDATE`; settles & marks `DELIVERED` |
| `POST /api/v1/sokoni/:orderId/driver-arrival-qr` | `MobileDriverReceiptCard` | `DRIVER` | `DoorstepQrController.generateArrivalQr` | Mints single-use `SKQR-*` bound to `orderId` |
| `POST /api/v1/sokoni/verify-doorstep-qr` | `QrDualPinTerminal` | `DRIVER`, `RETAILER` | `DoorstepQrController.verifyDoorstep` | Atomic QR + Dual-PIN closure under `SERIALIZABLE` |
| `POST /api/v1/marketplace/catalog/clone/:globalCatalogId` | `InventoryAndUnitManager`, `public/sw.js` | `RETAILER`, `WHOLESALER` | `CatalogCloneController.cloneToMerchant` | Initializes `0` stock, `0` TZS + atomic adoption count |
| `POST /api/v1/marketplace/catalog/clone-standard` | `InventoryAndUnitManager` | `RETAILER`, `WHOLESALER` | `CatalogCloneController.cloneStandard` | Canonical SKU base-zero cloning |
| `GET /api/v1/hybrid/analytics/:businessId/daily-revenue` | `HybridAnalyticsDashboard` | `WHOLESALER`, `SUPER_ADMIN` | `HybridAnalyticsController.getDailyRevenue` | Tenant ownership guard + B2B/B2C split |
| `GET /api/v1/hybrid/analytics/export-csv` | `ConcurrencySmsCsvPanel`, `HybridAnalyticsDashboard` | `WHOLESALER`, `SUPER_ADMIN` | `SwahiliCsvExportController.exportCsv` | UTF-8 BOM + Swahili headers + formula-injection guard |
| `POST /api/v1/wholesale/eod-settle/:driverId` | `WholesalerEodReconciliation` | `WHOLESALER`, `SUPER_ADMIN` | `EodReconciliationController.settleDriver` | Blocks if open `PENDING_SMS_SYNC` or `DISPUTED` exist |
| `POST /api/v1/notifications/push/subscribe` | `webPushRegistrationService.ts` | Authenticated (`isAuthenticated`) | `WebPushController.subscribe` | Extracts `userId` from JWT; upserts VAPID keys |
| `POST /api/v1/callback/nextsms/incoming` | External NextSMS Gateway | `NextSmsTokenGuard` (`X-NextSMS-Gateway-Token`) | `NextSmsWebhookController.handleInbound` | Parses compact SMS + constant-time `SIG6` HMAC check |
| `POST /api/v1/admin/marketplace/catalog/add-item` | `SuperAdminDashboardLayout` | `SUPER_ADMIN` | `AdminCatalogController.addItem` | `SERIALIZABLE` master SKU insert |
| `POST /api/v1/admin/marketplace/catalog/categories` | `SuperAdminDashboardLayout` | `SUPER_ADMIN` | `AdminCatalogController.addCategory` | Creates `soko_catalog_categories` + ImageKit folder |
| `GET /api/v1/admin/marketplace/catalog/telemetry` | `SuperAdminDashboardLayout` | `SUPER_ADMIN` | `AdminCatalogController.getTelemetry` | Returns adoption counts & cluster metrics |
| `POST /api/v1/sales/leads/:leadId/convert` | `SalesLeadsDashboard` | `SUPER_ADMIN` | `SalesLeadsController.convertLead` | Optimistic `version` lock + `409 Conflict` + Welcome SMS |
| `GET /api/v1/geospatial/stores-map-matrix` | `FullPageMarketplaceMap` | `SUPER_ADMIN` or `geospatial_map_enabled=TRUE` | `GeospatialController.getMapMatrix` | Fail-closed `403` when tenant flag is `FALSE` |
| `POST /api/v1/admin/tenant/toggle-map` | `AdminMerchantsDirectoryPanel` (`Merchants & Settings`) | `SUPER_ADMIN` | `GeospatialController.toggleTenantMap` | Updates `business_profiles.geospatial_map_enabled` (Merchant alias: `/api/v1/admin/merchants/:merchantId/toggle-map`) |
| `GET /api/v1/admin/docs/blueprints` | `SuperAdminDashboardLayout` | `SUPER_ADMIN` | `AdminSystemDocsController.getDocs` | Strict `SUPER_ADMIN` encapsulation |

---

## 3. Real-Time STOMP & BroadcastChannel Mapping

| Frontend Topic / Channel | Frontend Subscriber(s) | Event Token / Payload | NestJS Realtime Producer |
| :--- | :--- | :--- | :--- |
| `WS /ws-sokokuu` -> `/topic/admin/managed-alerts` (fallback `BroadcastChannel('sokokuu_admin_managed_alerts')`) | `BrandedAppBarWithAlerts.tsx`, `AdminAlertTerminal.tsx`, `SuperAdminDashboardLayout.tsx` | `ROUTED_PLATFORM_MANAGED_HELPDESK`, `NEW_B2B_ORDER_REQUEST`, `STANDARD_UPDATE` | `RealtimeGateway` triggered by `q.realtime.admin-alerts` (`AFTER_COMMIT`) |
| `WS /ws-sokokuu` -> `/user/queue/alerts` | `BrandedAppBarWithAlerts.tsx` | Private user order & PIN alerts | `RealtimeGateway.sendToUser(userId, ...)` |
| `/topic/driver/reconciliation/{driverId}` (fallback `BroadcastChannel('sokokuu-driver-reconciliation')`) | `IsolatedQrVerificationTerminal.tsx`, `MobileDriverReceiptCard.tsx` | `TRIGGER_DRIVER_PIN_MODAL_OPEN`, `AWAIT_COUNTERPARTY_PIN`, `CLOSE_TERMINAL_SETTLED` | `WebSocketQrVerificationService` via `afterCommit` outbox -> `RealtimeGateway` |
| Browser Service Worker `push` event (`public/sw.js`) | Background OS notification + `notificationclick` deep-link | `{ title, body, url, tag }` | `WebPushDispatchService` (`web-push` + VAPID keys) |
