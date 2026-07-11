# ADR-0001: Multi-Tenancy Model

Date: 2026-07-11
Status: Accepted

---

## Problem

SharePoint Knowledge Health is enterprise SaaS serving multiple customer organizations, but no tenant isolation model is defined anywhere in the current documentation or schema. This affects the Prisma schema, the auth flow, and every single database query, so it must be settled before the data model is built.

## Context

- Auth is Microsoft Entra ID; each customer organization has its own Entra tenant.
- Stack is a single NestJS API backed by a single PostgreSQL database via Prisma (per `tech-stack.md`, `database-rules.md`).
- Architecture rules say "do not create microservices unless required" — favors a single shared deployment over per-tenant infrastructure.
- Security rules require least privilege and no cross-tenant data exposure.

## Options Considered

**A. Database-per-tenant**
Strongest isolation. Every new customer requires provisioning a new database and running migrations against it. Operationally heavy for an MVP with an unproven customer base; complicates connection pooling and cross-tenant analytics.

**B. Schema-per-tenant (shared Postgres instance, separate schema per customer)**
Better isolation than shared tables, avoids full database provisioning. Still requires per-tenant migration orchestration and dynamic schema routing in Prisma, which Prisma does not support natively without extra tooling.

**C. Shared database, shared schema, `organizationId` discriminator column on every tenant-scoped table**
Standard row-level multi-tenancy. Single schema, single migration path, minimal operational overhead. Requires disciplined enforcement (every query must be scoped) but that can be centralized in a repository layer or Prisma middleware.

## Recommended Decision

**Option C** — shared database, shared schema, `organizationId` as a required column on every tenant-scoped table (`Site`, `Document`, `HealthScore`, `ScoreHistory`, etc.), resolved from the validated Entra ID token on every request.

Enforce scoping centrally: a base repository (or Prisma middleware) that injects `organizationId` into every query, rather than relying on each service to remember to filter. This keeps the "controllers thin, services hold logic, no raw queries in controllers" architecture rule intact while closing the main risk of this approach (accidental cross-tenant leakage).

## Tradeoffs

- Weaker isolation guarantee than schema- or database-per-tenant; a bug in the scoping layer is a data-leak risk. Mitigated by centralizing enforcement and adding integration tests that specifically assert cross-tenant isolation.
- Significantly simpler to build, migrate, and operate for an MVP — one schema, one migration history, one connection pool.
- Consistent with "avoid premature abstraction" and "do not over-engineer MVP features" from `engineering-principles.md`.

## Future Considerations

- If a large enterprise customer requires dedicated infrastructure for compliance reasons, migrate that specific tenant to schema-per-tenant or database-per-tenant without changing the model for everyone else.
- Revisit if query performance at scale suffers from a single large shared table set — partitioning by `organizationId` is possible later without a full re-architecture.
- Concrete entity definitions and field-level tenant isolation rules are specified in ADR-0007 (Domain Model). Usage limits (e.g., max documents, scan frequency, seats) are intentionally *not* part of this ADR — see ADR-0007's notes on `Organization` and `ScanJob` for how the schema stays extensible for future plan gating without implementing billing now.
- The Entra ID application backing authentication is multi-tenant, not per-customer (see ADR-0003 addendum); this is an auth/consent detail only and does not change the isolation model here.
