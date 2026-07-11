# ADR-0004: SharePoint Scan Architecture

Date: 2026-07-11
Status: Accepted

---

## Problem

No design exists for how or when SharePoint metadata retrieval happens. The context docs repeatedly call out pagination, throttling, and retry-with-backoff handling for Graph API calls — all signs that a scan is a long-running operation that cannot safely run synchronously inside a single HTTP request/response cycle.

## Context

- `microsoft-graph.md` and `docs/api/microsoft-graph.md` require pagination, throttling handling, and exponential backoff retries.
- The dashboard requires historical trends (`document-health-score.md`), implying scans happen repeatedly over time, not just once.
- Architecture rules say "do not create microservices unless required" — the solution should stay inside the existing NestJS deployment where possible.
- Realistic SharePoint tenants can have thousands to millions of documents across many sites; a synchronous scan would exceed any reasonable HTTP timeout.

## Options Considered

**A. Synchronous in-request scan**
Simplest to implement, but breaks immediately at real-world document volumes — HTTP timeouts, a blocked request thread, and no way to show scan progress. Not viable.

**B. Background job queue (e.g., BullMQ on Redis)**
"Trigger scan" API enqueues a job and returns immediately; a worker processes sites/documents page by page via the Graph module, respecting throttling/backoff, writing results incrementally to Postgres, and updating job status. Frontend polls a scan-status endpoint.

**Amended by ADR-0009**: the worker is deployed as its own Azure Container App (`apps/worker`), not a process inside the API's deployment as originally described here. It has no public HTTP endpoints and is reachable only by consuming from the Redis queue. This is a packaging refinement, not a change to the async, queue-based design decided below.

**C. Scheduled recurring scans (cron-based) in addition to on-demand**
Adds value (automatic freshness) but also adds scheduling infrastructure and questions about scan frequency/cost per tenant. Not required for the MVP's core "get a score" loop.

## Recommended Decision

**Option B**, with recurring scans (Option C) explicitly deferred to v2.

- A job queue (BullMQ + Redis) is added as new infrastructure. The worker is a separate deployable app (`apps/worker`, per ADR-0009) but is still not a "microservice" in the prohibited sense — it exposes no API and communicates only through shared infrastructure (Postgres, Redis), never synchronous network calls — consistent with "no microservices unless required."
- Scan API: `POST /scans` enqueues, returns a job id; `GET /scans/:id` returns status/progress; completed scan writes `Document` rows and triggers score calculation (ADR-0002).
- MVP scans are manually triggered only ("Run Scan" button). No cron scheduling in MVP.

## Tradeoffs

- Introduces Redis and a queue library as new dependencies — a deviation from "avoid unnecessary dependencies" — but justified because there is no viable synchronous alternative at real tenant scale, and a queue is needed again for v2 scheduled/webhook-driven scans regardless.
- Deferring scheduled scans keeps MVP scope tight and matches "do not over-engineer MVP features," at the cost of requiring users to manually re-trigger scans to refresh their score.

## Future Considerations

- v2: scheduled recurring scans (cron per organization, configurable frequency).
- v2: incremental/delta scans using the Graph delta query API instead of always re-scanning the full document set — reduces Graph API load and scan duration significantly.
- v2: webhook-driven near-real-time updates for high-value sites, once the queue infrastructure already exists to support it.
