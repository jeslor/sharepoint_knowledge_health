# System Overview

> Supersedes the earlier `overview.md`. Describes the system as actually
> built, not aspirational architecture. See `docs/decisions/` (ADRs) for the
> reasoning behind each choice referenced here.

## What this system does

SharePoint Knowledge Health scans an organization's SharePoint document
libraries, scores each document against a fixed set of governance criteria
(staleness, missing owner, sensitivity labeling, permission sprawl, etc. —
see ADR-0002), and surfaces the results as a dashboard, historical trend,
and governance-issue queue. Scans run on-demand or on an organization's own
recurring schedule (ADR-0015). Findings can be triaged into governance
workflows with an audit trail (ADR-0016). It is multi-tenant: each
`Organization` maps to a real customer, isolated from every other
organization's data (ADR-0001).

## The three applications

| App | Runtime | Purpose | Public ingress |
|---|---|---|---|
| `apps/web` | Next.js | Dashboard, auth (MSAL), scan/schedule/governance UI | Yes |
| `apps/api` | NestJS (Express) | REST API: auth verification, tenant-scoped CRUD, enqueues scans | Yes |
| `apps/worker` | NestJS application context (no HTTP adapter) | Consumes BullMQ jobs: SharePoint document collection, scoring, the scan scheduler heartbeat | No (ADR-0009) |

Each is an independently deployed Azure Container App with its own
Dockerfile and deployment lifecycle (ADR-0006, ADR-0009), sharing
TypeScript packages from one pnpm/Turborepo monorepo.

## Shared packages (`packages/`)

- **`@sph/types`** — cross-app contracts: API request/response DTOs, queue
  payload shapes (`SCAN_QUEUE`, `SCHEDULER_QUEUE`), health-check types.
  Pure types/constants, no runtime logic.
- **`@sph/config`** — the Zod `envSchema` and `validateEnvOrExit()`, called
  first thing in both `apps/api` and `apps/worker`'s bootstrap (Phase 9).
- **`@sph/database`** — the only supported way to reach PostgreSQL:
  `createTenantContext(organizationId)` returns a repository set that is
  structurally incapable of leaking across tenants for ordinary queries
  (see `security-model.md`). Also owns `checkDatabaseConnection()`.
- **`@sph/graph-client`** — Microsoft Graph app-only client (client
  credentials flow via MSAL), used exclusively by `apps/worker` (ADR-0013).
- **`@sph/scoring`** — the pure scoring algorithm (ADR-0002), consumed by
  `apps/worker`'s document collector.

Every package consumed by a *compiled* Node app (`apps/api`, `apps/worker`)
must ship a real CommonJS build (`tsconfig.build.json` → `dist/`, with
`package.json` `main`/`types`/`exports` pointing at `dist/`, not `src/`).
`packages/types`, `database`, and `graph-client` were built this way from
the start; `packages/config` was fixed to match during Phase 9 — it
previously pointed `main` at `./src/index.ts`, which would have crashed the
moment either compiled app tried to `require('@sph/config')` in production.

## High-level data flow

```
Browser (apps/web, MSAL login)
   │  Bearer <Entra ID token>
   ▼
apps/api  (NestJS)
   │                         │
   │ reads/writes            │ enqueues ScanJobPayload
   ▼                         ▼
PostgreSQL (Prisma)      Redis (BullMQ: SCAN_QUEUE, SCHEDULER_QUEUE)
   ▲                         │
   │ writes results          ▼
   └──────────────────  apps/worker (NestJS app context, no HTTP)
                              │
                              ▼
                     Microsoft Graph API → SharePoint
```

`apps/worker` also runs its own producer: a BullMQ repeatable job
(`SCHEDULER_QUEUE`) ticks every 15 minutes, finds due `ScanSchedule` rows
across all tenants, and enqueues onto `SCAN_QUEUE` — the exact same queue
and payload shape a manually-triggered scan uses. Scheduling is a second
*producer*, never a second *execution path* (ADR-0015). See
`worker-pipeline.md` for the full walkthrough.

## Feature areas (by capability, not phase)

- Microsoft Entra authentication (multi-tenant app registration, ID-token
  bearer auth) — ADR-0011.
- Multi-tenant authorization (organization + role-based) — ADR-0001,
  ADR-0012.
- SharePoint site discovery and approval-gated scan scope — ADR-0014.
- Document collection and scoring — ADR-0002, ADR-0004.
- Health dashboard (current snapshot + summary) — ADR-0007.
- Scheduled scans — ADR-0015.
- Historical snapshots and trend charts — ADR-0015.
- Governance issue workflows and audit trail — ADR-0016.
- Executive/governance analytics — Phase 8D.

## Where to read next

- `request-flow.md` — a concrete request walked through every layer.
- `worker-pipeline.md` — document collection and the scheduler tick.
- `deployment.md` — required infrastructure and how each app is deployed.
- `security-model.md` — auth, tenant isolation, and known residual risk.
- `operations.md` — health checks, logging, and day-2 operational notes.
- `database.md` — Prisma/PostgreSQL conventions.
