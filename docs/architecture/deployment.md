# Deployment

Describes required infrastructure and how each app is actually packaged and
run today. Reflects ADR-0006 (infrastructure choices), ADR-0008 (Azure as
the platform), and ADR-0009 (app boundaries) plus what Phase 9 hardened.
This is not a description of provisioned Infra-as-Code — no Bicep/Terraform
exists in this repo yet (see "Known gap" below); it documents what the
target environment must provide.

## Required infrastructure

| Component | Choice | Notes |
|---|---|---|
| Compute | Azure Container Apps (one per app: `apps/web`, `apps/api`, `apps/worker`) | Consumption-based, KEDA-backed. `apps/worker` is intended to scale on BullMQ/Redis queue depth (a native KEDA scaler) — not yet configured as IaC in this repo, see below. |
| Database | Azure Database for PostgreSQL — Flexible Server | Single instance, no HA/read replica at current scale (an accepted ADR-0006 tradeoff, revisit if uptime/read-load requires it). |
| Queue/cache | Azure Cache for Redis — Standard tier | Standard (not Basic) specifically because Basic has no SLA/replication, and the scan pipeline's correctness depends on the queue. |
| Secrets | Azure Key Vault | `ENTRA_CLIENT_SECRET` and `DATABASE_URL`/`REDIS_URL` connection strings sourced from here in production, injected as container env vars — never baked into an image. |
| Registry | Azure Container Registry (ACR) | One registry, all three images. |
| Monitoring | Azure Monitor + Application Insights | See `operations.md`. |
| Identity | Azure Entra ID — one multi-tenant App Registration | See `security-model.md` for the trust model; requirements below. |

All three apps run in one Azure Container Apps **Environment** (ADR-0006),
sharing that environment's virtual network, but each is an independently
deployed container image and revision (ADR-0009) — a deploy of one never
requires redeploying the others.

## Azure App Registration requirements

- **Multi-tenant** ("accounts in any organizational directory") — required
  because each customer authenticates against their *own* Entra tenant, not
  a shared one (ADR-0001, ADR-0011).
- **Two** redirect URIs registered as **SPA** platform entries:
  - `NEXT_PUBLIC_REDIRECT_URI` — `apps/web`'s deployed origin, where MSAL's
    own `loginRedirect` lands (unchanged, existing).
  - `NEXT_PUBLIC_ADMIN_CONSENT_REDIRECT_URI` — the "Connect Microsoft 365"
    admin-consent callback (`/connect/admin-consent-callback`, Phase 6).
    Deliberately a **separate** URI from the MSAL sign-in redirect: this is
    Microsoft's raw admin-consent endpoint callback, not an MSAL-mediated
    redirect, and its query-string shape (`?tenant=&admin_consent=&state=`
    or `?error=&error_description=`) is not something MSAL's
    `handleRedirectPromise()` recognizes — keeping them as two distinct
    registered URIs avoids two different redirect-response shapes ever
    landing on the same page.
- **API permissions** (ADR-0003 + its amendments), application (app-only),
  granted via tenant-admin consent at each customer's onboarding — not
  delegated:
  - `Files.Read.All` — read (scanning).
  - `Sites.Read.All` — read (scanning).
  - `Sites.ReadWrite.All` — **required for review-date write-back**
    (ADR-0022 remediation / ADR-0016). This is the app's one SharePoint
    write action: setting a document's mapped review-date column via
    `PATCH .../listItem/fields`. Write-back is part of MVP (owner decision,
    2026-09-12); `REQUIRED_PERMISSION_VERSION` is `2` (permission-state.ts),
    so a tenant that consented before this scope was added correctly enters
    the re-consent state (`needsReconsent`/`needsWriteConsent`) and the
    remediation feature is gated off until an admin re-consents.
  - Deliberately **no** `Files.ReadWrite.All` — write-back only touches
    SharePoint list-item field values, never file content, so the file
    write scope is not requested (least privilege).
- One client secret (`ENTRA_CLIENT_SECRET`), rotated via Key Vault,
  consumed by `@sph/graph-client`'s MSAL client-credentials flow (used only
  by `apps/worker` — both the read scans and the review-date write-back run
  there; `apps/api` only ever verifies incoming ID tokens, it never
  acquires Graph tokens itself).

## Required environment variables

Validated eagerly at boot by `@sph/config`'s `validateEnvOrExit()` (Phase
9) — both `apps/api` and `apps/worker` call this as the very first line of
`bootstrap()`, before any DI container is created. A missing or malformed
value now exits the process immediately with a clear message, instead of
surfacing later as an opaque failure deep in a request handler.

| Variable | Used by | Notes |
|---|---|---|
| `NODE_ENV` | all | `development` \| `test` \| `production`, defaults to `development` |
| `DATABASE_URL` | api, worker | Postgres connection string, must be a valid URL |
| `REDIS_URL` | api, worker | Redis connection string, must be a valid URL |
| `ENTRA_CLIENT_ID` | api, worker | The app registration's client ID — validated as the JWT `aud` claim |
| `ENTRA_CLIENT_SECRET` | worker (via `@sph/graph-client`) | MSAL client-credentials flow secret |
| `API_PORT` | api | Defaults to `3001` if unset |
| `WORKER_CONCURRENCY` | worker | BullMQ processor concurrency for `SCAN_QUEUE`, defaults to `5` |
| `WEB_APP_ORIGIN` | api | Phase 9: comma-separated allowed CORS origins; defaults to `http://localhost:3000` if unset — **must be set explicitly in staging/production** |
| `NEXT_PUBLIC_ENTRA_CLIENT_ID`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_REDIRECT_URI` | web | MSAL/browser-side config, baked in at Next.js build time |
| `NEXT_PUBLIC_ADMIN_CONSENT_REDIRECT_URI` | web | Phase 6: the "Connect Microsoft 365" admin-consent callback URI (see above); optional — defaults to `${origin}/connect/admin-consent-callback` if unset, matching how `NEXT_PUBLIC_REDIRECT_URI` defaults to `window.location.origin` |

Local development uses `docker-compose.yml` (Postgres 16 + Redis 7 only —
the three apps themselves run via `pnpm dev`, not containerized locally)
and a root `.env` file (`apps/api`/`apps/worker` load it via
`ConfigModule.forRoot({ envFilePath: '../../.env' })`, which is a no-op in
Docker/CI where no `.env` file exists — those environments inject
`process.env` directly instead).

## Container images

All three Dockerfiles (`apps/*/Dockerfile`) follow the same shape: a
`turbo prune --docker` step to extract only the workspace slice each app
actually needs, a `pnpm install --frozen-lockfile` install stage, a build
stage (`db:generate` + `turbo build`, with a dummy `DATABASE_URL` — Prisma
only needs one to *parse* the schema at generate time, never to connect),
and a slim non-root runtime stage.

- `apps/api`: `EXPOSE 3001`, `CMD node apps/api/dist/main.js`.
- `apps/worker`: **no `EXPOSE`** — intentional, matches "no public HTTP
  ingress" (ADR-0009) at the container level, not just Container Apps
  ingress configuration.
- `apps/web`: Next.js standalone output only (not the full
  `node_modules`), matching Next.js's recommended minimal production image.

## Scheduled work

There is no external cron/scheduled-task infrastructure. The recurring
scan tick lives *inside* `apps/worker` as a BullMQ repeatable job
registered on boot (`SchedulerBootstrapService`, see `worker-pipeline.md`)
— running the worker container is sufficient; no separate Azure Scheduled
Job / Logic App / cron trigger needs to be provisioned.

## CI/CD — known gap

`.github/workflows/ci.yml` currently runs install → Prisma generate →
migrate deploy (against ephemeral Postgres/Redis service containers) →
lint → typecheck → test, on every PR and push to `main`. It does **not**
build images, push to ACR, or deploy to Container Apps — ADR-0006 states
the intended shape (GitHub Actions → ACR → Container Apps, standardized
across all three apps) but the deploy stage was never built, since it
requires real Azure credentials this repo doesn't have configured. This is
an accepted, documented gap for this phase — see the Phase 9 report's
roadmap for the recommendation to build it out next, rather than attempted
here without real credentials to validate against.

Database migrations in production would be applied via `prisma migrate
deploy` as an explicit deploy step (matching what CI already does against
its ephemeral database) — there is no automatic migration-on-boot in
either app.

## Tuning considerations (not yet needed, worth knowing)

- Prisma's client has no explicit `connection_limit` configured — fine at
  current scale, but each `apps/api`/`apps/worker` replica opens its own
  pool, so `replica count × connection_limit` should be checked against
  Postgres Flexible Server's `max_connections` before scaling replica count
  up significantly.
- `apps/worker`'s `WORKER_CONCURRENCY` (BullMQ concurrency) and Container
  Apps replica count are two separate scaling dimensions — increasing
  either increases concurrent Graph API calls, which are subject to
  Microsoft Graph's own throttling.
