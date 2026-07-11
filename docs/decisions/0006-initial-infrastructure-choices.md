# ADR-0006: Initial Infrastructure Choices

Date: 2026-07-11
Status: Accepted (superseded 2026-07-11: full Azure-native consolidation, including frontend; see Revision History)

---

## Problem

Infrastructure needed concrete choices — compute target, database hosting, secrets management, monitoring, and CI/CD — before Dockerfiles and deployment pipelines could be built.

## Context

- MVP workload: a Next.js frontend, a NestJS API, and a background worker process (ADR-0004) that runs long-lived, queue-driven scan jobs — not a good fit for pure request/response serverless.
- Security rules require environment-variable-based config, no hardcoded secrets, no logged credentials.
- Engineering principles: avoid over-engineering, but also make decisions that support future scale — infrastructure choices should be boring and standard rather than clever.
- Azure was chosen as the target cloud platform in ADR-0008; this ADR covers the specific Azure services and how they're wired together, not the platform-level rationale.

## Options Considered

**Compute (Frontend, API, Worker)**
- A. **Azure Container Apps for all three (frontend, API, worker)** — a single compute platform, containerized, consumption-based pricing with scale-to-zero, built on KEDA. KEDA's Redis/queue scalers let the scan worker scale directly on BullMQ queue depth — a native fit for the async scan architecture already decided in ADR-0004. One deployment model, one registry, one CI/CD target for the whole application.
- B. Split frontend to Vercel, backend (API + worker) to Container Apps — gains Vercel's Next.js-specific edge optimizations (managed image CDN, automatic per-PR preview URLs, zero-config ISR) at the cost of a second provider, a second deployment pipeline, and a second place to manage environment config/CORS/redirect URIs.
- C. Azure Kubernetes Service (AKS) for all three — more orchestration control than needed at MVP scale; adds cluster management overhead with no corresponding benefit yet.

**Database**
- A. **Azure Database for PostgreSQL — Flexible Server** — managed backups, patching, HA options; standard choice matching `database-rules.md`.
- B. Self-managed Postgres on a VM — more operational burden, no offsetting benefit at this stage.

**Cache / Queue Backing**
- A. **Azure Cache for Redis** — Standard tier (not Basic — MVP needs the SLA/replication since the scan pipeline's correctness depends on Redis availability, not just its performance).
- B. Basic tier — cheaper, but no SLA or replication; rejected because the job queue is load-bearing infrastructure, not a cache that can silently degrade.

**Secrets**
- A. **Azure Key Vault** — rotation support, integrates with Container Apps secret references, keeps the Graph app client secret and DB credentials out of plain environment config.
- B. Plain environment variables via CI/CD only — simpler, but weaker for the "never hardcode secrets / never log credentials" security rules, especially for the Graph API client secret.

**Container Registry**
- **Azure Container Registry (ACR)** — the only real option once compute is Container Apps; Basic tier is sufficient for MVP image volume.

**Monitoring**
- A. **Azure Monitor + Application Insights** — native integration with Container Apps (no separate agent to install), captures logs/metrics/traces and distributed tracing across the API and worker with minimal setup, direct cost/usage tie-in to the rest of the Azure bill.
- B. Third-party APM (e.g., Datadog, Grafana Cloud) — richer dashboards/alerting ecosystem in some cases, but adds a second vendor, separate billing, and integration work with no MVP-stage justification given Application Insights already covers the core need (request tracing, error rates, scan job duration/failure visibility).

## Recommended Decision

**Single-platform Azure deployment** for the entire application:

- **Frontend**: Next.js app containerized and deployed on **Azure Container Apps**.
- **API**: NestJS API on **Azure Container Apps**, with public ingress.
- **Worker**: Scan worker on **Azure Container Apps**, internal ingress only, scaled via KEDA on BullMQ/Redis queue depth (scale-to-zero when idle between scans).
- **Container Registry**: **Azure Container Registry (ACR)**, Basic tier for MVP, holding all three images (frontend, API, worker).
- **Database**: **Azure Database for PostgreSQL — Flexible Server**, Burstable tier for MVP, single instance (no HA yet).
- **Queue**: **Azure Cache for Redis**, Standard tier, backing the BullMQ job queue from ADR-0004.
- **Secrets**: **Azure Key Vault** for the Graph API client secret, database credentials, and session/JWT signing secrets, referenced by Container Apps secret bindings at runtime. No secrets in plain environment variables or committed config anywhere, including the frontend.
- **Monitoring**: **Azure Monitor + Application Insights**, instrumented on the API and worker (request tracing, error rates, scan job duration/failure/success counts) and the frontend (page-level errors, Core Web Vitals where feasible).
- **CI/CD**: **GitHub Actions**, one workflow with three path-filtered, independent jobs (one per app — see ADR-0009 for the monorepo structure this depends on): run lint/tests on every PR; on merge to main, each app whose files (or shared package dependencies) changed builds its Docker image, pushes to ACR, and deploys a new revision to its corresponding Azure Container App. Apps with no relevant changes are not rebuilt or redeployed.

All three apps communicate within a single Azure environment; CORS is still required between the frontend and API origins (separate Container Apps get separate ingress URLs), but there is no cross-cloud networking, secrets, or deployment surface to manage.

## Tradeoffs

- Consolidating the frontend onto Container Apps gives up Vercel's Next.js-specific benefits: automatic per-PR preview deployments, a managed global edge/image CDN, and zero-config ISR. These would need to be approximated manually (e.g., preview environments via a GitHub Actions workflow that stands up a temporary Container Apps revision) if they become necessary later — not available out of the box the way they were with Vercel.
- A single cloud platform for the whole application is simpler operationally (one registry, one deployment target, one place for secrets/monitoring/networking) at the direct cost of Vercel's frontend-specific polish — an accepted tradeoff given the goal of a single, coherent Azure-native deployment story (ADR-0008).
- Azure Cache for Redis Standard tier costs more than Basic, but Basic has no SLA or replication — not acceptable for a component the scan pipeline depends on for correctness.
- Single PostgreSQL Flexible Server instance (no HA, no read replica) is an accepted MVP limitation — acceptable while customer count and load are both low.
- Application Insights is "good enough" APM for MVP but has a smaller ecosystem of pre-built dashboards/integrations than dedicated third-party APM tools — acceptable while the team is small and the primary need is basic request/error/job visibility, not deep custom observability tooling.

## Future Considerations

- Add PostgreSQL Flexible Server zone-redundant HA and/or read replicas once uptime SLAs or read load justify the cost.
- Revisit Container Apps vs. AKS if workload complexity grows enough to need more granular orchestration control than Container Apps' revision model provides.
- If losing Vercel's preview-deployment workflow meaningfully slows down frontend iteration, build an equivalent using ephemeral Container Apps revisions per PR rather than reintroducing a second cloud provider.
- Revisit third-party APM if Application Insights' dashboards/alerting prove insufficient once real usage data exists.
- `.claude/context/tech-stack.md` reflects this Azure-only infrastructure; keep it in sync with this ADR going forward.

## Revision History

- **2026-07-11 (original)**: Accepted AWS (ECS Fargate + RDS + ElastiCache + Secrets Manager + ECR) paired with Vercel for the frontend.
- **2026-07-11 (revision 2)**: Superseded the AWS backend choice with an Azure-native stack (Container Apps + PostgreSQL Flexible Server + Azure Cache for Redis + Key Vault + ACR) following an explicit cost/scalability/enterprise-fit/operational-complexity/migration-path evaluation against AWS and a single-VM option. Vercel frontend hosting was retained at this point.
- **2026-07-11 (revision 3 — this revision)**: Consolidated the frontend from Vercel onto Azure Container Apps as well, added Azure Monitor + Application Insights for monitoring, and standardized CI/CD on a single build-push-deploy shape (GitHub Actions → ACR → Container Apps) for all three apps. Platform-level rationale for Azure over AWS/GCP now lives in ADR-0008. Reversal made before any infrastructure was built, at zero migration cost.
