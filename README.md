# SharePoint Knowledge Health

Assess the quality and governance of the SharePoint content that powers Microsoft 365 Copilot and custom AI agents.

SharePoint Knowledge Health is **not a chatbot**. It's a knowledge-governance tool: it scans an organization's SharePoint document libraries, scores each document against a fixed set of governance criteria, and gives admins a way to find, assign, and fix the underlying problems.

## Why SharePoint Knowledge Health?

AI systems like Microsoft 365 Copilot can only answer as well as the content they draw from. If a SharePoint tenant is full of stale, duplicated, ownerless, unreviewed, or poorly classified documents, that's what Copilot (or any custom agent built on the same content) will surface — this product makes no claim about how Copilot specifically behaves, only that the underlying content quality is what any such system depends on.

The product's own framing: **knowledge quality before AI**. It focuses on governance — measuring and improving the content — not generation.

## What It Does

1. An admin connects their Microsoft 365 tenant (Entra ID admin consent) and approves which SharePoint sites are in scope.
2. A background worker scans those sites via Microsoft Graph, collecting document **metadata only** (never file content).
3. Each document is scored against seven governance criteria, producing a 0–100 Document Health Score, a health band, and a list of specific issues.
4. Admins and governance managers track issues to resolution, assign document owners, get notified when something needs attention, and can bulk-fix missing review dates by writing a value back to SharePoint.
5. Every privileged action is recorded in an audit log; every organization's data is fully isolated from every other organization's.

## Key Features

- **SharePoint / Microsoft Graph scanning** — recursive traversal of every drive and folder on each approved site, idempotent re-scans (upsert by `(siteId, graphItemId)`), and safe reconciliation of removed documents.
- **Document Health Score** — seven weighted criteria (see below), an explainable per-criterion breakdown, and dashboard-level recommendations.
- **Scheduled scans** — an organization can configure a recurring scan cadence in addition to on-demand scans.
- **Historical trends** — point-in-time snapshots after every completed scan, surfaced as trend charts and scan-to-scan comparisons.
- **Governance issue workflow** — track a detected problem, assign it to a user, move it through `Open → In Progress → Resolved`, with a resource-scoped self-service path for the assignee.
- **Knowledge owner coverage reporting** — organization-wide and per-site rollups of how much content has an identifiable, active owner.
- **Taxonomy / classification coverage** — admins designate which SharePoint columns represent their organization's classification scheme; the score reports whether those columns are populated (coverage, not validity — there's no controlled-vocabulary/Term Store check).
- **Bulk remediation (review-date write-back)** — an admin can select up to 500 documents missing a review date and set one value across all of them in a single background job, with per-item progress, retry, and a targeted write-verification step before the underlying governance issue is auto-resolved.
- **In-app notifications** — issue assignment, reassignment, reopening, and a periodic "this looks resolved — confirm?" check, surfaced in-app only (no email/Teams/Slack delivery).
- **Audit log** — an append-only record of administrative actions (site approval, tenant connect/reconnect, schedule changes, manual scan triggers, bulk remediation).
- **Multi-tenant organization isolation** — every tenant-scoped table carries an `organizationId`; application code can only reach the database through a repository layer that is structurally incapable of an unscoped query.
- **Microsoft Entra authentication** — a single multi-tenant Entra ID app registration; each customer signs in against their own Azure AD tenant.
- **Admin consent / re-consent** — a dedicated "Connect Microsoft 365" flow drives tenant-wide admin consent, and tenants that consented before a newer required permission was added are detected and gated until they re-consent.

## How It Works

```mermaid
flowchart TD
    Browser["Browser (apps/web, Next.js)"] -- "Bearer <Entra ID token>" --> API["apps/api (NestJS REST API)"]
    API -- reads/writes --> DB[(PostgreSQL via Prisma)]
    API -- enqueues ScanJob --> Redis[(Redis / BullMQ)]
    Redis --> Worker["apps/worker (NestJS, no public endpoint)"]
    Worker -- reads/writes --> DB
    Worker --> Graph["Microsoft Graph API"]
    Graph --> SharePoint[(SharePoint)]
```

Three independently deployed applications share TypeScript packages from one pnpm/Turborepo monorepo:

| App | Runtime | Responsibility | Public ingress |
|---|---|---|---|
| `apps/web` | Next.js | Dashboard, MSAL sign-in, scan/schedule/governance UI | Yes |
| `apps/api` | NestJS | REST API — auth verification, tenant-scoped CRUD, enqueues scans/remediation jobs | Yes |
| `apps/worker` | NestJS application context (no HTTP server) | Consumes the queue — SharePoint scanning, scoring, scheduled-scan heartbeat, review-date write-back, notification reconciliation | No |

**Why `api` and `worker` are separate apps, not one process:** scanning a SharePoint tenant is a long-running, bursty, queue-driven job — a bad fit for a request/response API process. Splitting them lets the worker scale independently (including to zero between scans) without affecting API availability, and keeps a slow or failing scan from ever blocking a dashboard request. They never call each other directly; their only coupling is the shared Postgres database, the Redis-backed queue, and shared packages (`packages/database`, `packages/graph-client`, `packages/types`, `packages/config`) — so despite being three deployable units, this is a frontend/backend split plus a background worker, not a microservices architecture.

`apps/web` never touches Postgres, Redis, or Microsoft Graph directly — it only calls `apps/api` over REST.

## Health Score

Every scored document gets a 0–100 composite score from seven independent criteria:

| Criterion | Weight | What it measures |
|---|---|---|
| Freshness | 25% | How recently the document was modified |
| Ownership | 20% | Whether the document has an identifiable, active owner |
| Review Status | 15% | Whether a review date is set, and whether it's overdue |
| Metadata Completeness | 15% | Intrinsic document hygiene (e.g. filename quality) |
| Duplication | 10% | An exact-match signal (identical name + size) — not fuzzy/content similarity |
| Taxonomy | 10% | Whether the organization's designated classification columns are populated (coverage, not validity) |
| Document Age | 5% | How old the document is |

Each criterion is a pure, independently testable function returning a 0–100 sub-score plus an optional issue. The composite score is a weighted sum of all seven, and is classified into a band: **90–100 Healthy**, **70–89 Needs Attention**, **below 70 Requires Review**. A `HealthIssue` is generated for any individual criterion that scores below 70, so a document can sit in a healthy composite band while still surfacing one specific weak signal.

**How missing/unconfigured criteria are handled** (this matters for interpreting a score):
- **Taxonomy**: if an organization hasn't designated any classification columns for a library, Taxonomy scores a neutral **100** with no issue — an unconfigured organization is never penalized for a policy it hasn't set up.
- **Review Status**: has three real states — no review date set (scores 0), a review date in the past ("Overdue," scores 50), and a review date in the future (scores 100). A date within 30 days is flagged as "Due Soon" for display only; it is not a separate scored state.
- **Duplication**: deliberately a basic, exact-match heuristic for this version — a renamed or lightly-edited copy will not be detected as a duplicate.

Weights and thresholds are code constants (`packages/scoring/src/config.ts`), not user-configurable per organization.

## SharePoint Permissions

The app registration requests three Microsoft Graph **application (app-only)** permissions, granted via tenant-admin consent — never delegated, never per-user:

| Permission | Purpose |
|---|---|
| `Files.Read.All` | Read-only — document/file metadata for scanning |
| `Sites.Read.All` | Read-only — site and drive enumeration for scanning |
| `Sites.ReadWrite.All` | Write — required only for the review-date bulk-remediation feature |

`Files.ReadWrite.All` is deliberately **never** requested: the one write action this product performs sets a single SharePoint list-item column value (`PATCH .../listItem/fields`) for a review date — it never touches file content. A tenant that hasn't granted `Sites.ReadWrite.All` continues to work identically for everything except bulk remediation, which is gated off with an explicit re-consent prompt rather than failing unclearly.

## Privacy and Data Handling

- **Document content is never downloaded.** The scanner reads metadata only — name, size, timestamps, owner, MIME type, and (for classification/review-date features) specific SharePoint column values. No document body ever leaves SharePoint.
- **Raw classification field values are not persisted** — a column's value is read at scan time only to compute a populated/not-populated signal and is then discarded; only the resulting score is stored. The review-date feature is the one exception: a document's actual review-due date (a date, never file content) *is* stored on the `Document` row, since surfacing and remediating that date is the feature itself.
- **Tenant isolation is structural, not conventional**: every tenant-scoped table carries an `organizationId`, and the only sanctioned way application code reaches the database is a per-organization repository set with no unscoped query method to call by accident.
- **Authentication uses bearer ID tokens**, not cookies/sessions — validated server-side against Microsoft's published signing keys on every request; the frontend never stores tokens in `localStorage` (MSAL's session-scoped storage only).
- **The Microsoft Graph client secret and database/Redis connection strings** are meant to be sourced from a secret store (Azure Key Vault in the documented deployment) and are never logged or baked into a container image.
- **Audit trail**: administrative actions and governance activity are recorded in append-only tables (no `update`/`delete` method exists on their repositories). This is enforced at the application layer today, not yet at the database-privilege layer — see `docs/architecture/security-model.md` for the documented plan and rationale.

## Tech Stack

- **Frontend**: Next.js 15, React 18, TypeScript, Tailwind CSS, Fluent UI React components, MSAL (`@azure/msal-browser`/`@azure/msal-react`)
- **Backend**: NestJS 10, TypeScript, BullMQ (Redis-backed queues)
- **Database**: PostgreSQL, Prisma ORM
- **Microsoft Graph**: `@microsoft/microsoft-graph-client` + `@azure/msal-node` (app-only client-credentials flow)
- **Auth verification**: `jose` (JWT/JWKS validation against Entra ID)
- **Monorepo tooling**: pnpm workspaces, Turborepo
- **Testing**: Jest (unit/integration) across every app and package — there is no Playwright/Cypress/browser-driven end-to-end suite in this repository
- **Infrastructure (documented deployment)**: Docker, GitHub Actions, Azure Container Apps, Azure Container Registry, Azure Key Vault, Azure Monitor/Application Insights, Neon (managed PostgreSQL), Upstash (managed Redis)

## Project Structure

```
apps/
  web/        Next.js dashboard and auth UI — REST-only client of apps/api
  api/        NestJS REST API — auth, tenant-scoped CRUD, enqueues jobs
  worker/     NestJS app context (no HTTP) — scanning, scoring, remediation, notifications
packages/
  types/                   Shared TypeScript types — API request/response DTOs, queue payloads
  config/                  Zod env-var schema, validated eagerly at boot
  database/                Prisma client + the tenant-scoped repository layer
  graph-client/            Microsoft Graph integration (pagination, throttling, auth, the one write function)
  scoring/                 The pure Document Health Score algorithm
  review-date-discovery/  Pure logic for finding candidate SharePoint review-date columns
prisma/
  schema.prisma           Full data model
  migrations/              Migration history
docs/
  architecture/            System overview, deployment, security model, CI/CD, database, worker pipeline
  decisions/               ADRs — the full history and rationale behind every design decision
  features/                Feature-level specs
  product/                 Vision and roadmap
  testing/                 Local acceptance testing plan and results
```

## Getting Started

### Prerequisites

- **Node.js** `>=20.18.0 <21` (see `.nvmrc`)
- **pnpm** `>=9` (`packageManager: pnpm@9.15.0`)
- **Docker** (for local Postgres/Redis via `docker-compose.yml`) — the three apps themselves run directly via `pnpm dev`, not in containers, for local development
- **A Microsoft 365 tenant** you control (or a developer tenant) and permission to create an **Entra ID app registration** with admin-consent rights
- **At least one SharePoint site** in that tenant to scan

### Clone

```bash
git clone https://github.com/jeslor/sharepoint_knowledge_health.git
cd sharepoint_knowledge_health
```

### Install

```bash
pnpm install
```

### Environment configuration

Copy the repository's [`.env.example`](.env.example) to a root `.env` file and fill in real values:

```bash
cp .env.example .env
```

The env schema (`packages/config/src/env.schema.ts`) is validated eagerly at boot by both `apps/api` and `apps/worker` — a missing or malformed required value exits the process immediately with a clear message.

| Variable | Required | Used by | Secret? | Notes |
|---|---|---|---|---|
| `NODE_ENV` | No (defaults `development`) | all | No | `development` \| `test` \| `production` |
| `DATABASE_URL` | Yes | api, worker | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | api, worker | Yes | Redis connection string (BullMQ) |
| `ENTRA_CLIENT_ID` | Yes | api, worker | No | Entra app registration's client ID; validated as the JWT `aud` claim |
| `ENTRA_CLIENT_SECRET` | Yes | api, worker | Yes | Used by the Graph client's app-only (client-credentials) token acquisition — both `apps/api` (consent verification, SharePoint metadata lookups) and `apps/worker` (scanning, remediation) call into `@sph/graph-client` |
| `EMAIL_API_KEY` | No | api | Yes | Resend API key — only used by the "Request an upgrade" email notice; the API boots fine without it, but that one endpoint returns a `503` to the user if it's missing (the request is still recorded server-side) |
| `EMAIL_FROM` | No | api | No | Verified sender address for the same optional email feature |
| `API_PORT` | No (defaults `3001`) | api | No | |
| `WORKER_CONCURRENCY` | No (defaults `5`) | worker | No | BullMQ processor concurrency for the scan queue |
| `REMEDIATION_WORKER_CONCURRENCY` | No (defaults `3`) | worker | No | BullMQ per-item concurrency for the bulk remediation queue |
| `WEB_APP_ORIGIN` | No (defaults `http://localhost:3000`) | api | No | Comma-separated allowed CORS origins — set explicitly outside local dev |
| `NEXT_PUBLIC_ENTRA_CLIENT_ID` | Yes | web | No | Baked in at Next.js **build time** |
| `NEXT_PUBLIC_API_BASE_URL` | Yes | web | No | Baked in at build time |
| `NEXT_PUBLIC_REDIRECT_URI` | No (defaults to the page's own origin) | web | No | MSAL sign-in redirect URI; baked in at build time |
| `NEXT_PUBLIC_ADMIN_CONSENT_REDIRECT_URI` | No (defaults to `${origin}/connect/admin-consent-callback`) | web | No | The "Connect Microsoft 365" admin-consent callback; baked in at build time |

All `NEXT_PUBLIC_*` variables are inlined into the client bundle at build time — changing one requires rebuilding the web app, not just restarting it.

### Database

Start local PostgreSQL and Redis:

```bash
docker compose up -d
```

This starts Postgres 16 on `5432` and Redis 7 on `6379`, matching `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sharepoint_knowledge_health` and `REDIS_URL=redis://localhost:6379`.

Generate the Prisma client and apply migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

### Microsoft Entra / SharePoint setup

1. Create an **Entra ID app registration**, set to **multi-tenant** ("accounts in any organizational directory").
2. Register two **SPA** redirect URIs:
   - Your web app's origin (e.g. `http://localhost:3000`) — MSAL's sign-in redirect.
   - `http://localhost:3000/connect/admin-consent-callback` — the admin-consent callback (a distinct URI from the MSAL redirect; Microsoft's admin-consent response shape isn't something MSAL's own redirect handler recognizes).
3. Add **application (app-only)** Graph API permissions: `Files.Read.All`, `Sites.Read.All`, and `Sites.ReadWrite.All` (only needed if you want to exercise the review-date bulk-remediation feature).
4. Create a client secret and put it in `ENTRA_CLIENT_SECRET`.
5. Start the app and use the in-app **"Connect Microsoft 365"** flow (`/connect`) to drive tenant-wide admin consent — this is the only supported way to bootstrap a new organization; signing in alone does not create one.

### Run the application

```bash
pnpm dev
```

This runs `turbo run dev --parallel`, starting `apps/web`, `apps/api`, and `apps/worker` together. To run one app at a time, use `pnpm --filter @sph/api dev` (or `@sph/web`, `@sph/worker`).

### Verify it works

```bash
curl -fsS http://localhost:3001/health          # liveness — always 200 if the process is up
curl -fsS http://localhost:3001/health/ready    # readiness — 503 if Postgres or Redis is unreachable
```

`apps/worker` has no HTTP endpoint by design (see Architecture above) — verify it's working by checking its logs for the scheduler heartbeat, or by triggering a scan from the dashboard and watching a `ScanJob` progress to `Completed`.

## Development

| Command | What it does |
|---|---|
| `pnpm dev` | Run all three apps in watch mode |
| `pnpm build` | Build all apps/packages (Turborepo, dependency-graph-aware) |
| `pnpm lint` | Lint all apps/packages |
| `pnpm typecheck` | Type-check all apps/packages |
| `pnpm test` | Run all Jest suites |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:migrate` | Run `prisma migrate dev` locally |
| `pnpm format` / `pnpm format:check` | Prettier write / check |

Each command can be scoped to one workspace, e.g. `pnpm --filter @sph/scoring test`.

## Testing

Every app and package has its own Jest suite (unit and integration). `packages/database`'s tests run against a real Postgres connection (`dotenv -e ../../.env -- jest --runInBand`) — start `docker compose up -d` first. CI (`.github/workflows/ci.yml`) runs the full suite against ephemeral Postgres/Redis service containers on every pull request.

**Known limitation**: there is no browser-driven end-to-end test suite (no Playwright/Cypress) in this repository. `docs/testing/local-acceptance-testing.md` and its accompanying report describe a manual acceptance-testing pass against a real Microsoft 365 tenant instead.

## Deployment

The documented production architecture (see `docs/architecture/deployment.md` and `docs/architecture/cicd.md` for the full runbook):

- **Compute**: Azure Container Apps — `web`, `api`, and `worker` each as an independently deployed container (the worker runs with no public ingress and a minimum of one replica, since its in-process scan scheduler must never scale to zero).
- **Database**: Neon (managed serverless PostgreSQL), reached over TLS.
- **Queue/cache**: Upstash (managed serverless Redis), reached over the standard Redis protocol with TLS.
- **Registry**: Azure Container Registry.
- **Secrets**: Azure Key Vault, referenced by the Container Apps via a managed identity.
- **CI/CD**: GitHub Actions — `ci.yml` validates every pull request; `deploy.yml` builds and pushes images on merge to `main`, runs `prisma migrate deploy`, then rolls out a new revision per app. Azure authentication uses GitHub OIDC (no long-lived cloud secret).

This repository does not include Infrastructure-as-Code (no Bicep/Terraform) — initial infrastructure is provisioned manually once, documented step-by-step in `docs/architecture/cicd.md`.

## Security

See `docs/architecture/security-model.md` for the full authentication, authorization, and tenant-isolation model, and `docs/decisions/` for the reasoning behind each security-relevant decision (Microsoft Graph permission scope, the authentication trust model, tenant isolation). There is no `SECURITY.md` in this repository yet, so there is no dedicated vulnerability-reporting process to point to — please open an issue for anything non-sensitive, or contact the maintainer directly for anything sensitive.

## Limitations / Current Scope

This project documents its own scope deliberately rather than presenting itself as feature-complete:

- **Duplicate detection is exact-match only** (identical file name + size) — not fuzzy or content-similarity based. Downloading file content to support real similarity detection would also conflict with the product's metadata-only design.
- **No Term Store / controlled-vocabulary validation** — the taxonomy criterion measures whether designated columns are populated, not whether the values are valid or consistent.
- **Remediation write-back is narrow by design** — exactly one write action exists (setting a document's mapped review-date column). There is no generic workflow/action engine, and a second action type is intentionally not built until this one is proven in production.
- **Notifications are in-app only** — no email, Microsoft Teams, or Slack delivery.
- **No browser/end-to-end test suite** — Jest unit/integration tests only.
- **No rate limiting, no `helmet` security headers, and no automated dependency vulnerability scanning** on the API today.
- **No database-level write-immutability** for the audit log / governance activity tables yet — enforced at the application layer only (see Privacy and Data Handling above).
- **No Infrastructure-as-Code** — the documented Azure deployment is provisioned manually, once.

## Contributing

There is no `CONTRIBUTING.md` in this repository yet. In the meantime:

1. Fork and clone the repository.
2. Create a feature branch.
3. `pnpm install`.
4. Make your changes.
5. Run `pnpm lint && pnpm typecheck && pnpm test` before opening a pull request.
6. Open a pull request describing what changed and why.

## Documentation

- [`docs/architecture/`](docs/architecture/) — system overview, request flow, worker pipeline, database, deployment, CI/CD, security model, operations
- [`docs/decisions/`](docs/decisions/) — the full set of architecture decision records
- [`docs/features/`](docs/features/) — feature-level specifications
- [`docs/product/`](docs/product/) — product vision and roadmap
- [`docs/testing/`](docs/testing/) — local acceptance testing plan and results

## License

No license file is currently included in this repository. Until one is added, no open-source license is granted, and the default (all rights reserved) applies.

## Roadmap

See [`docs/product/roadmap.md`](docs/product/roadmap.md) for the current, maintained roadmap.

## Product Links

- **Live application**: https://sph.jeslor.com/
- **Repository**: https://github.com/jeslor/sharepoint_knowledge_health
