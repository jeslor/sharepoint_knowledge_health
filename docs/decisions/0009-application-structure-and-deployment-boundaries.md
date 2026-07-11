# ADR-0009: Application Structure and Deployment Boundaries

Date: 2026-07-11
Status: Accepted

---

## Problem

ADR-0006 established that `web`, `api`, and `worker` all run as separate Azure Container Apps, but never defined the repository/package structure, build boundaries, or communication contracts between them. Phase 1 cannot start scaffolding a monorepo without this settled — it directly determines the folder structure of the first commit.

## Context

- Three deployable units are already decided: `web` (Next.js), `api` (NestJS), `worker` (NestJS + BullMQ) — all on Azure Container Apps (ADR-0006).
- Architecture rules require external integrations (Microsoft Graph) to live in isolated modules, and tenant isolation (ADR-0001) must be enforced consistently everywhere the database is touched — both `api` and `worker` touch the database, so this enforcement cannot live in only one of them.
- The scan pipeline (ADR-0004) is queue-based: `api` enqueues, a worker consumes. That worker is now a distinct app, not a process inside `api`'s deployment — this refines ADR-0004's original wording (see Amendments below).
- Engineering principles: avoid unnecessary dependencies, avoid premature abstraction, but support future scale.

## Options Considered

**Repository shape**
- A. **Monorepo**: `apps/{web,api,worker}` + `packages/*` for shared code, single Git repository.
- B. Polyrepo: three separate repositories. Rejected — the three apps are tightly coupled (shared domain types, shared tenant-isolation/database layer, shared Graph client), and a polyrepo would force publishing/versioning internal packages through a registry just to share code between apps that deploy together. Unjustified overhead at this stage.

**Monorepo tooling**
- A. **pnpm workspaces + Turborepo** — minimal, standard for this exact `apps/` + `packages/` shape; Turborepo provides task orchestration and dependency-graph-aware caching (a change to `packages/types` correctly triggers rebuilds of everything that depends on it; a change to `apps/web` alone does not touch `api` or `worker`).
- B. Nx — more powerful (code generators, more sophisticated dependency graph visualization, plugin ecosystem) but a heavier, more opinionated tool than a three-app MVP monorepo needs. Revisit only if the number of apps/packages grows enough to justify it.
- C. Plain npm/yarn workspaces, no task orchestrator — works for dependency linking but has no build caching or dependency-graph-aware task running, meaning every CI run would rebuild everything regardless of what changed, undermining the independent-deployment-lifecycle requirement below.

## Decision

**Monorepo using pnpm workspaces + Turborepo**, structured as:

```
apps/
  web/        Next.js frontend — has its own Dockerfile
  api/        NestJS API — has its own Dockerfile
  worker/     NestJS + BullMQ scan worker — has its own Dockerfile
packages/
  types/      Shared TypeScript types/interfaces (domain entities per ADR-0007, API request/response DTOs)
  config/     Shared configuration schema (env var validation) and shared constants (e.g., the ADR-0002 scoring weights/bands config object)
  database/   Prisma client + the tenant-scoped repository layer (ADR-0001 enforcement) — consumed by api and worker only, never by web
  graph-client/  Microsoft Graph integration module (pagination, throttling, backoff, token handling — ADR-0003) — consumed by api and worker
```

### App boundaries and communication contracts

- **`web`** talks to **`api`** exclusively over REST (`api-rules.md`). It never touches the database, Redis, or the Graph client directly, and therefore does not depend on `packages/database` or `packages/graph-client` — only `packages/types` (for typed API responses) and `packages/config` (for its own runtime config, e.g., API base URL).
- **`api`** creates `ScanJob` rows and enqueues them onto the BullMQ/Redis queue (ADR-0004). It does not process scans itself. It depends on `packages/database`, `packages/graph-client` (for lightweight lookups, e.g., listing sites during tenant onboarding — see ADR-0007's `MicrosoftTenant`/`SharePointSite` flow), `packages/types`, and `packages/config`.
- **`worker`** consumes `ScanJob`s from the Redis queue, performs the actual Graph pagination/ingestion, computes health scores (ADR-0002), and persists results — the full scan pipeline from ADR-0004. It depends on `packages/database`, `packages/graph-client`, `packages/types`, and `packages/config`. **`worker` exposes no public HTTP endpoints** — its Container Apps ingress is internal-only (already specified in ADR-0006); it is reachable only by consuming from Redis, never by direct request from `web` or `api`.
- `api` and `worker` never call each other directly (no HTTP RPC between them). Their only coupling is through shared infrastructure — the Postgres database and the Redis-backed queue — and through the shared `packages/database`/`packages/graph-client` code, which guarantees both apply the same tenant-isolation and Graph-handling rules rather than each reimplementing them and risking drift.

### Why this isn't a "microservices" architecture

`architecture.md` prohibits microservices "unless required." Three independently deployed containers could look like a violation, but the distinguishing factor is the **absence of synchronous inter-service APIs**: `worker` has zero API surface, and `api`/`worker` never call one another over the network. The only cross-app contract is `web → api` REST (a normal frontend/backend split, not a microservices topology) plus shared infrastructure (DB, queue). This is "one application, three deployable processes," not a distributed microservices architecture — no service discovery, no inter-service versioning, no network RPC between backend components.

### Deployment lifecycle independence

Each app has its own Dockerfile (above) and its own CI/CD trigger: GitHub Actions workflows are path-filtered so that a change under `apps/web/**` builds and deploys only the `web` Container App, `apps/api/**` only `api`, `apps/worker/**` only `worker`. A change under `packages/**` triggers a rebuild/redeploy of every app that depends on that package (Turborepo's dependency graph determines which — e.g., a `packages/database` change rebuilds `api` and `worker` but not `web`). This refines ADR-0006's CI/CD description, which described a single combined pipeline; the pipeline is now one workflow with three independent, path-aware jobs rather than one job that always builds all three.

## Tradeoffs

- Shared packages (`database`, `graph-client`, `types`, `config`) mean a bug or breaking change in a shared package can affect multiple apps at once — mitigated by Turborepo's dependency-graph-aware CI, which forces the full dependent set to rebuild and test, not just the package itself.
- pnpm + Turborepo is a new toolchain the team has to learn if unfamiliar, but it's a small, focused addition (not a heavy framework like Nx) directly justified by the independent-deployment-lifecycle requirement.
- Enforcing "web never imports `packages/database` or `packages/graph-client`" is a convention, not (yet) a hard technical barrier — recommend lint rules (e.g., dependency-boundary ESLint rules or Turborepo's package-level `exports` restrictions) once the monorepo exists, so this stays enforced rather than aspirational as the codebase grows.

## Future Considerations

- If `api` and `worker` diverge enough in their Graph or database usage patterns that sharing `packages/graph-client`/`packages/database` becomes awkward, split per-app copies then — don't preemptively split now.
- Revisit Nx if the number of apps/packages grows enough that Turborepo's simpler model becomes limiting.
- A future `packages/scoring` could extract the ADR-0002 scoring engine into its own shared package if `api` ever needs to compute or preview scores directly (e.g., a "what-if" recommendation simulator) rather than only reading persisted `HealthScore` rows — not needed for Phase 1, where only `worker` invokes the scoring engine.

## Amendments to Prior ADRs

- **ADR-0004** ("the worker runs as a process within the existing NestJS application, not a separate microservice"): superseded by this ADR. The worker is now `apps/worker`, a distinct Container App with its own Dockerfile and deployment lifecycle — but the "no microservices" rationale still holds for the reason explained above (no inter-service network API), so ADR-0004's core architectural conclusion (queue-based, async, no synchronous scan) is unchanged, only the deployment packaging is refined.
- **ADR-0006** (CI/CD description): "single pipeline shape... build Docker images for frontend/API/worker... on merge to main" is refined to path-filtered, independent per-app jobs within one GitHub Actions workflow, as described above.
