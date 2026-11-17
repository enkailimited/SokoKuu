# ADR-005: Zero-Float Quarter-Quanta Inventory & Integer TZS Currency Representation

- **Status**: Accepted
- **Date**: 2026-11-17
- **Deciders**: SokoKuu TZ Principal Architecture Team
- **Scope**: Inventory, Pricing, Orders, and Financial Ledgers (`05-catalog`, `06-inventory`, `07-pricing`, `09-orders`, `10-financials`, `11-cod-verification`)

---

## 1. Context

Tanzanian FMCG B2B2C commerce regularly sells both bulk sacks/cartons (e.g., `50 KG` rice/flour sacks, `20 L` cooking oil jerricans) and street-level fractional duka portions (`0.25 KG` "Robo", `0.50 KG` "Nusu", `1.00 KG`, `2.00 KG`), priced in Tanzanian Shillings (TZS) where whole-shilling integers apply and sub-unit floating-point arithmetic (`0.1 + 0.2 = 0.30000000000000004` or `1.25 - 0.25`) causes silent inventory drift, rounding bugs in sack deconstruction (`auto_break_bulk_package`), and reconciliation mismatches in Cash-on-Delivery ledgers.

`src/data/blueprints.ts` explicitly mandates **Zero-Float Architecture** across PostgreSQL columns, Java services, and TypeScript models.

---

## 2. Decision

Enforce **100% integer representation** across all database columns, NestJS domain arithmetic, DTOs, and API contracts for both physical quantities and TZS currency:

1. **Quarter-Quanta Physical Stock Units (`INTEGER` / `BIGINT`)**:
   - `1` Quantum = `0.25` base unit (`1 Robo` = `1`, `1 Nusu` = `2`, `1 KG / 1 L / 1 Piece` = `4`, `50 KG Sack` = `200`).
   - All columns (`bulk_stock_units`, `retail_shelf_quanta`, `quanta_per_bulk_package`, `requested_quanta`, `minimum_quanta_threshold`) are stored as PostgreSQL `INTEGER` / `BIGINT` (`CHECK >= 0` where non-negative).
   - NestJS services (`06-inventory`, `08-procurement`, `09-orders`) use integer-only math (`Number.isSafeInteger(...)` validation in DTOs) and delegate bulk-to-shelf deconstruction exclusively to `auto_break_bulk_package()` under `FOR UPDATE` locks.
2. **Integer Tanzanian Shillings (`BIGINT` -> safe TypeScript `number` / `bigint` serialization)**:
   - All monetary amounts (`unit_price_tzs`, `total_amount_tzs`, `expected_cash_amount`, `collected_cash_amount`, `b2b_revenue_tzs`, `b2c_revenue_tzs`) are stored as PostgreSQL `BIGINT` whole TZS values.
   - Zero `FLOAT`, `DOUBLE PRECISION`, `REAL`, or IEEE-754 floating-point percentages are permitted in monetary or stock calculations. Discounts/splits use integer basis points or explicit integer division with deterministic remainder rules.
3. **API Serialization Contract**:
   - TZS amounts and quarter-quanta values serialize as JSON integers (never floating-point strings or decimals). Display formatting (`TSh 81,600`, `0.25 KG (Robo)`) happens strictly at the presentation edge.

---

## 3. Consequences

### Positive
- Completely eliminates floating-point rounding drift during high-frequency duka robo sales (`-1` quantum) and 50 KG sack break-bulk events (`+200` quanta).
- Guarantees exact equality checks (`collected_cash_amount === expected_cash_amount`) in Cash-on-Delivery Dual-PIN reconciliation without epsilon tolerances.
- Preserves exact parity with PostgreSQL `BIGINT`/`INTEGER` schemas in `src/data/blueprints.ts`.

### Trade-offs & Mitigations
- **Developer Familiarity with Quanta vs. Decimal KG**: Mitigated by explicit domain naming (`*Quanta`, `*Tzs`), dedicated TypeScript helper converters (`quantaToDisplayLabel`, `kgToQuantaChecked` with `Math.round` + remainder check rejecting non-0.25 multiples), and strict ESLint/DTO validators (`@IsInt()`, `@Min(0)`).
- **`BIGINT` Serialization in Prisma**: Prisma returns `BIGINT` as JS `bigint`; `common/` JSON serialization middleware converts safe-range `bigint` values cleanly to integer JSON numbers (or validates `<= Number.MAX_SAFE_INTEGER`) so frontend TypeScript types remain identical.

---

## 4. Alternatives Considered

1. **PostgreSQL `NUMERIC(12, 2)` / `decimal.js`**: Rejected because quarter-quanta integers (`1 = 0.25`) are faster, smaller, natively atomic in SQL (`retail_shelf_quanta - 1`), and explicitly mandated by `src/data/blueprints.ts`.
2. **IEEE-754 JavaScript `number` floats**: Rejected due to non-exact decimal arithmetic and risk of fractional stock leaks.
