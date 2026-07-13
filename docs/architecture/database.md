# Database

- **Database**: PostgreSQL (Azure Database for PostgreSQL Flexible Server
  in production — see `deployment.md`).
- **ORM**: Prisma. Schema at `prisma/schema.prisma`; migrations applied via
  `prisma migrate deploy` (production/CI) or `prisma migrate dev` (local).

## Access pattern

Application code never calls the Prisma client directly for tenant-scoped
tables. The only sanctioned access path is
`createTenantContext(organizationId)` (`packages/database`), which returns
a fixed set of repositories, each pre-scoped to that one `organizationId`.
There is no unscoped method on these repositories to call by accident —
tenant isolation is a structural property of the access layer, not a
convention developers have to remember to apply per-query (ADR-0001).

Exactly two unscoped queries exist in the whole codebase, both required
because they run *before* an `organizationId` is knowable, and both are
documented in place where they're defined:

- `findUserByEntraIdentity` (`src/identity.ts`) — resolves a user during
  auth, before tenant context exists.
- `findDueScanSchedules` (`src/scheduler.ts`) — "which schedules are due,
  across every org," the scheduler tick's entry point (see
  `worker-pipeline.md`).

`checkDatabaseConnection()` (`src/health-check.ts`, Phase 9) is a third
"unscoped" query in the literal sense (`SELECT 1`), but it touches no
application data — it exists purely as the readiness probe's connectivity
check (see `operations.md`).

## Rules

- Never bypass Prisma (no raw `pg` client, no ORM-adjacent query builder).
- Never use raw SQL unless genuinely necessary — `checkDatabaseConnection`'s
  `$queryRaw\`SELECT 1\`` is the one example today, chosen specifically
  because it's the cheapest possible real round-trip to prove the
  connection is alive, not a stand-in for a missing Prisma feature.
- Use migrations for every schema change — no `db push` in any environment
  that matters.
- Use transactions for multi-step writes that must succeed or fail
  together.
- Index columns that are actually queried against — every repository's
  primary lookup path (`organizationId` scoping, `(siteId, graphItemId)`
  upsert keys, `(enabled, nextRunAt)` for the scheduler's due-schedule
  query) has a corresponding index in the schema.

## Idempotency conventions

- `Document` rows are upserted by `(siteId, graphItemId)` — a rescan never
  creates duplicates.
- `DocumentOwner` rows are partitioned by `source` (`GraphMetadata` vs.
  `ManualAssignment`, ADR-0016 §4.2) — the worker only ever deletes/recreates
  its own `GraphMetadata`-sourced rows, never touching a governance-assigned
  manual owner.
- `HealthSnapshot.scanJobId` is unique — at most one snapshot per scan.
- `ScanSchedule.organizationId` is unique — one schedule per organization.
