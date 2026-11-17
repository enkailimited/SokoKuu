# ADR-002: Hybrid Prisma ORM with Raw PostgreSQL, PostGIS, and PL/pgSQL Procedures

- **Status**: Accepted
- **Date**: 2026-11-17
- **Deciders**: SokoKuu TZ Principal Architecture Team
- **Scope**: Persistence Layer (`backend/prisma/`, `backend/src/database/`)

---

## 1. Context

SokoKuu TZ relies on database-level invariants defined in `src/data/blueprints.ts` (`V1`–`V10` SQL migrations):
1. **PostGIS Spatial Types & Functions**: `GEOGRAPHY(Point, 4326)`, `GIST` spatial indexes, `ST_DWithin`, `ST_Distance`, and `get_businesses_ordered_by_proximity()`.
2. **Database-Enforced Channel Harmony Triggers**: `trg_validate_tier_packaging_rules` and `trg_enforce_pure_store_pricing` preventing retail/wholesale boundary violations even from direct SQL or batch imports.
3. **Serialized PL/pgSQL Deconstruction Procedure**: `auto_break_bulk_package()` acquiring `FOR UPDATE` locks before opening wholesale sacks into fractional retail robo quanta.
4. **Atomic Adoption Counter Trigger**: `trg_increment_global_catalog_adoption` updating `soko_global_catalog.cloned_by_stores_count`.
5. **Pessimistic Row Locks & Isolation Levels**: `SELECT ... FOR UPDATE` on `cash_delivery_ledgers` and `products`, and `SERIALIZABLE` transactions for Dual-PIN CoD reconciliation and dynamic pricing edits.

Prisma ORM's schema DSL does not natively model PostGIS `GEOGRAPHY`, PL/pgSQL stored procedures, triggers, or row-level `FOR UPDATE` clauses without raw SQL escape hatches.

---

## 2. Decision

Use **Prisma ORM as the primary typed data-access and migration ledger**, paired with **SQL-first Prisma migrations and encapsulated `$queryRaw` / `$executeRaw` repository methods** for spatial, procedural, and pessimistic-locking operations.

- **Schema & Migrations (`backend/prisma/migrations/`)**:
  - Prisma manages table definitions and migration history (`_prisma_migrations`).
  - Unsupported PostGIS columns (`Unsupported("geography(Point, 4326)")`), `GIST` indexes, custom triggers, partial unique indexes, and PL/pgSQL functions are committed directly in versioned Prisma `migration.sql` files so every environment (`dev`, `test`, `prod`) runs identical database logic.
- **Explicit Transaction Helper (`PrismaService.runInTransaction`)**:
  - Wraps `$transaction(fn, { isolationLevel })` supporting `Serializable` and `RepeatableRead`, with typed helper methods for `SELECT ... FOR UPDATE` inside `06-inventory` and `11-cod-verification`.
- **Parameterized Raw Queries Only**:
  - All spatial (`ST_DWithin`, `ST_Distance`) and stored-procedure calls (`SELECT auto_break_bulk_package($1, $2, $3)`) strictly use Prisma tagged template literals (`Prisma.sql`) or positional parameters—never string concatenation (`$queryRawUnsafe` is banned).

---

## 3. Consequences

### Positive
- Preserves 100% of the PostgreSQL + PostGIS guarantees specified in `src/data/blueprints.ts` (`V1`–`V10`).
- Provides full TypeScript compile-time safety across standard CRUD, DTO mapping, and JSON projections.
- Eliminates any gap between ORM-level checks and database-level triggers.

### Trade-offs & Mitigations
- **Raw SQL Drift During `prisma migrate dev`**: Mitigated by reviewing generated `migration.sql` files before commit and running integration tests against a real PostGIS container (Testcontainers/Docker PostgreSQL+PostGIS) in CI.
- **Serialization Retries (`40001` / `P2034`)**: `SERIALIZABLE` transactions on Dual-PIN reconciliation and dynamic tier switching include bounded exponential backoff retry wrappers where idempotency is safe.

---

## 4. Alternatives Considered

1. **Pure Prisma Without Triggers/PostGIS**: Rejected because dropping PostGIS `GIST` proximity queries, `auto_break_bulk_package`, and Channel Harmony triggers violates zero architectural drift.
2. **TypeORM**: Rejected due to weaker TypeScript type inference, historical migration fragility, and less predictable SQL generation compared to Prisma + explicit SQL migrations.
