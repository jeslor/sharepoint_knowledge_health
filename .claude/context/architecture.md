# Architecture

## High Level

Three independently deployed apps (Azure Container Apps — see ADR-0006, ADR-0009), sharing TypeScript packages from a single monorepo:

```
User
  ↓
apps/web (Next.js)
  ↓  REST only
apps/api (NestJS)
  ↓  enqueues ScanJob            ↘ reads/writes via packages/database
Redis (BullMQ queue)              PostgreSQL (via Prisma)
  ↓  consumed by
apps/worker (NestJS + BullMQ, no public HTTP endpoint)
  ↓  reads/writes via packages/database      ↓ via packages/graph-client
PostgreSQL                                    Microsoft Graph API → SharePoint
```

`apps/api` and `apps/worker` never call each other directly — their only coupling is the shared Postgres database, the Redis-backed queue, and shared packages (`packages/database`, `packages/graph-client`, `packages/types`, `packages/config`). `apps/web` never touches the database, Redis, or Graph directly; it only calls `apps/api` over REST.

---

## Architecture Rules

Controllers should be thin.

Business logic belongs in services.

Database access goes through Prisma, via the shared `packages/database` tenant-scoped repository layer — never directly from `apps/web`.

External integrations (Microsoft Graph) must have isolated modules — `packages/graph-client`, shared by `apps/api` and `apps/worker`.

`apps/worker` must never expose a public HTTP endpoint. It is reachable only by consuming from the Redis queue.

Do not create microservices unless required. Three deployable apps is not a microservices architecture as long as there is no synchronous network API between backend apps (`apps/api` ↔ `apps/worker`) — see ADR-0009 for the full rationale.

Each app (`web`, `api`, `worker`) has its own Dockerfile and its own deployment lifecycle — see ADR-0009.
