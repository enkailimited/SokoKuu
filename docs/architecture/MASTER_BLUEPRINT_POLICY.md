# Master Blueprint Policy & Preservation Governance

**Platform**: SokoKuu TZ — B2B2C Enterprise Marketplace  
**Effective Date**: 2026-11-17  
**Target Active Runtime**: NestJS (TypeScript, Node.js LTS) housed strictly in `backend/`

---

## 1. Master Reference Artifact & Baseline Checksum

The file `src/data/blueprints.ts` serves as the **immutable canonical architecture specification** defining SokoKuu TZ's PostgreSQL/PostGIS schemas, PL/pgSQL procedures, Spring Security RBAC rules, Cash-on-Delivery Dual-PIN/QR verification ledgers, NextSMS 160-character compact protocol, hybrid unit deconstruction rules, and PWA integration contracts.

| Artifact Path | Role | Line Count | Verified SHA-256 Checksum |
| :--- | :--- | :---: | :--- |
| `src/data/blueprints.ts` | Master Backend Architecture Reference (61 Artifacts) | `8764` | `93b77ca4355cfbbc5a896dffb217b171fb9a1de7f007829b20496de0383e8683` |

---

## 2. Immutability Governance Rules

1. **Zero Modification Rule on `src/data/blueprints.ts`**:
   - No automated refactor, formatter, linter auto-fix, migration script, or engineer may delete, rename, reorder, truncate, or modify any line inside `src/data/blueprints.ts`.
   - The `SuperAdminDashboardLayout` Architecture Vault UI consumes `CODE_ARTIFACTS` directly from `src/data/blueprints.ts` and must remain bit-for-bit identical.
2. **React/Vite PWA & Historical Artifact Isolation**:
   - All root frontend files (`src/**`, `public/**`, `index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`) must remain isolated from backend NestJS dependencies so `npm run build` and `npm run lint` continue to succeed independently.
   - `deploy/compose.yml` (and any `deploy/Dockerfile` references in documentation) are preserved untouched as historical Spring Boot container reference artifacts.
   - All new NestJS code, dependencies, Prisma schemas, migrations, and Docker/Compose deployment definitions must live exclusively under `backend/` and `deploy/nestjs/`.
3. **Zero Architectural Drift During Stack Translation**:
   - Translating from Spring Boot 3.x / Java 21 to NestJS / TypeScript preserves every invariant from `src/data/blueprints.ts`:
     - Integer-only TZS (`BIGINT`) and integer Quarter-Quanta (`1 Robo = 1 quantum = 250g/250mL`, `50KG Sack = 200 quanta`).
     - Zero-Escrow Cash-on-Delivery (`cash_delivery_ledgers`) + Dual-PIN + Single-Use `SKQR-*` verification.
     - 160-character GSM-7 NextSMS protocol (`SK#REF8#SELLER#ITEMS#SIG6` and `SK#CANCEL#REF8#SIG6`) with constant-time HMAC-SHA256 validation.
     - Channel harmony (`WHOLESALE_HUB`, `RETAIL_DUKA`, `HYBRID_STORE`) and dynamic volume-based price routing.
     - Platform-Managed Order Interceptor (`is_platform_managed` -> `SUPER_ADMIN_HELPDESK_PIPELINE` vs `WHOLESALER_VENDOR_TERMINAL`).
     - Base-Zero catalog cloning (`0` stock, `0` TZS + atomic adoption counter + ImageKit CDN pointers).
     - PostGIS proximity (`GEOGRAPHY(Point, 4326)`, `ST_DWithin`, `ST_Distance`) and per-tenant `geospatial_map_enabled` (default `FALSE`).
     - Optimistic locking on `soko_leads` (`version`) and `cash_delivery_ledgers` (`version`).
     - White-label infrastructure naming (`SokoKuu Cloud SQL Database Cluster`, zero prohibited infrastructure brand strings).
     - **Merchant Terminology Standard**: Use `Merchant` / `Merchants` (`Wafanyabiashara`) across all Platform Administration APIs, OpenAPI/Swagger tags, DTOs, and domain services (never `"shop"`/`"shops"`), while keeping underlying SQL table names (`business_profiles`, `merchant_cloned_products`, `soko_leads`) faithful to `src/data/blueprints.ts`.

---

## 3. Checksum Verification Protocol

Before and after every implementation phase (`Phase 0`, `Phase 1`, and subsequent domain module phases), engineers must run:

```bash
sha256sum src/data/blueprints.ts
```

Any output differing from `93b77ca4355cfbbc5a896dffb217b171fb9a1de7f007829b20496de0383e8683` is a **P0 Governance Violation** requiring immediate revert of `src/data/blueprints.ts` before continuing.
