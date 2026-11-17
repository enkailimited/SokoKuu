# ADR-001: NestJS Modular Monolith Architecture

- **Status**: Accepted
- **Date**: 2026-11-17
- **Deciders**: SokoKuu TZ Principal Architecture Team
- **Scope**: Backend Workspace (`backend/`)

---

## 1. Context

`src/data/blueprints.ts` defines 61 interconnected Spring Boot enterprise artifacts spanning identity, RBAC, multi-tenant business profiles, PostGIS branch routing, base-zero global catalog cloning, quarter-quanta inventory deconstruction, dynamic volume pricing, procurement, store-locked B2B/B2C/POS orders, zero-escrow Cash-on-Delivery Dual-PIN ledgers, dispatch, STOMP/Web Push/NextSMS notifications, incoming SMS webhooks, compliance audit trails, and field-sales lead management.

We must port this architecture to a production-grade TypeScript NestJS backend without splitting transactional boundaries prematurely into distributed microservices, while still enforcing strict module boundaries and zero architectural drift.

---

## 2. Decision

Adopt a **16-Module NestJS Modular Monolith** inside `backend/src/modules/` backed by a shared PostgreSQL 16 + PostGIS 3.4 cluster, Redis 7, and RabbitMQ 3.13.

- **Module Encapsulation**: Each domain module (`01-identity` through `16-platform-admin`) owns its controllers, gateways, DTOs, domain services, and repository/Prisma queries.
- **Explicit Cross-Module Contracts**: Modules communicate strictly via exported NestJS provider interfaces (for synchronous transactional reads/writes within a shared ACID DB transaction) or via RabbitMQ domain events (for asynchronous post-commit side effects). Direct cross-module imports of internal repositories or private services are prohibited.
- **Shared Cross-Cutting Infrastructure**: `common/` (RFC 7807 exception filter, `ValidationPipe`, Pino logger), `config/` (typed Zod/Joi env validation with `TZ=Africa/Dar_es_Salaam`), `database/` (`PrismaService`), `redis/`, and `messaging/` (outbox relay & RabbitMQ).
- **Root PWA Isolation**: All backend code resides exclusively under `backend/` and `deploy/nestjs/`, leaving root React/Vite PWA files and `src/data/blueprints.ts` completely untouched.

---

## 3. Consequences

### Positive
- Preserves multi-entity ACID transactions across orders, inventory deconstruction, price tier lookups, audit traces, and Cash-on-Delivery ledger initialization without distributed two-phase commit complexity.
- Simplifies local developer onboarding, single-process deployment, and end-to-end Supertest integration testing.
- Maps cleanly 1-to-1 from the 61 Spring Boot blueprint components to idiomatic NestJS modules.
- Enables future extraction of high-throughput modules (e.g., `13-notifications` or `14-webhooks`) because asynchronous boundaries already use RabbitMQ events.

### Trade-offs & Mitigations
- **Risk of Accidental Coupling**: Mitigated by ESLint module-boundary rules and strict barrel exports (`*.module.ts` only exports public service interfaces).
- **Single-Process Scaling Limits**: Mitigated by stateless JWT auth, Redis-backed rate limiting/idempotency/pub-sub, and transactional outbox event delivery so horizontal NestJS replicas can run behind a load balancer.

---

## 4. Alternatives Considered

1. **Multi-Repo Microservices**: Rejected due to unacceptable operational overhead, distributed transaction fragility around `auto_break_bulk_package` and `cash_delivery_ledgers`, and slower iteration.
2. **Flat Express/MVC Layering**: Rejected because NestJS dependency injection, guards, interceptors, pipes, and module encapsulation are essential to preserve the enterprise structure of `src/data/blueprints.ts`.
