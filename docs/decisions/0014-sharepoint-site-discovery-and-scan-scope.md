# ADR-0014: SharePoint Site Discovery and Customer Scan Scope

Date: 2026-07-12
Status: Accepted (amended 2026-07-20 — discovery ownership moves to `apps/worker`)

---

## Problem

Nothing currently decides which SharePoint sites actually get scanned once a `MicrosoftTenant` is `Consented`. The Phase 5 architecture review flagged this as the most consequential open gap, not just a technical one: app-only `Files.Read.All`/`Sites.Read.All` consent grants our app *technical capability* to read every site in the tenant, but silently scanning all of them — including sites the customer never intended to expose to a third-party governance tool (HR, legal hold, executive-only sites) — would be a real trust violation for exactly the enterprise customers this product targets. This ADR makes the product-level scope decision the permission grant alone does not make.

## Context

- ADR-0003: app-only, read-only Graph permissions, granted once per tenant via admin consent.
- ADR-0007: `SharePointSite` already exists in the schema (`id`, `organizationId`, `microsoftTenantId`, `graphSiteId`, `siteUrl`, `displayName`, `lastScannedAt`, `createdAt`) — but has **no status/approval field**. This ADR requires adding one; that's a real schema gap, not an oversight this ADR works around.
- ADR-0009: `apps/api` already anticipated "lightweight lookups, e.g., listing sites during tenant onboarding" as an in-scope, synchronous use of `packages/graph-client` — site discovery fits exactly that shape and doesn't require re-litigating that decision.
- ADR-0012: this ADR's flow slots in immediately after a `MicrosoftTenant` reaches `Consented` status, extending (not replacing) the onboarding sequence already decided there.
- ADR-0013: `listSites`/`listDriveItems` are async generators returning Graph DTOs — discovery consumes `listSites`; scanning (unchanged, still async/queued per ADR-0004) consumes `listDriveItems`, but only for sites this ADR has approved.
- ADR-0011's trust model was about *authentication* (which claims we trust for identity). This ADR is the *data-access-scope* counterpart — a related but distinct kind of trust decision, worth stating explicitly rather than conflating the two.

## Decision

### The onboarding flow

```
Microsoft 365 Consent (ADR-0012)
        ↓
Discover SharePoint Sites   — synchronous, apps/api, via packages/graph-client.listSites
        ↓
Display discovered sites    — all sites the grant can see, status: Discovered, none scanned yet
        ↓
Administrator selects which sites are governed   — explicit, Admin-role-only action
        ↓
Persist approved sites      — status: Discovered → Approved, audit fields set
        ↓
Only approved sites are scanned   — ScanJob (ADR-0004) filters to status: Approved
```

**The governing principle, stated once and applied everywhere below**: the product never automatically scans a site — at onboarding, on rescan, or when new sites appear later — without an explicit, attributable admin action. Least privilege (ADR-0003, what the permission grant allows) and least exposure (this ADR, what we actually choose to read) are two separate, both-necessary layers of the same trust story.

### 1. Site discovery

Triggered automatically as the immediate next step after a `MicrosoftTenant` transitions to `Consented` (ADR-0012), within the same onboarding flow — no separate manual "start discovery" action needed, since discovery itself never exposes data, only *lists* what's visible. Originally implemented as a synchronous `apps/api` call to `packages/graph-client`'s `listSites(entraTenantId)` (ADR-0013); **execution ownership moved to `apps/worker` in the 2026-07-20 amendment** (see below) — the trigger point and everything else in this section is unchanged.

Every discovered site is persisted immediately as a `SharePointSite` row with `status: Discovered` — not held in some separate, unpersisted "candidate" structure. Considered and rejected keeping discovered-but-unapproved sites out of the database entirely (e.g., a lighter cache/candidate table): it would mean re-querying Graph live every time an admin opens the site-selection screen (slower, and inconsistent if Graph's live listing shifts between page loads), for no real benefit — the existing `SharePointSite` table, tenant-scoped and repository-backed since Phase 3, already does everything a separate structure would, plus it naturally supports the "diff against what's already known" need for future rescans (§4).

### 2. Administrator site selection

Restricted to `Admin`-role users only (Phase 4's `RolesGuard`/`@Roles('Admin')`, already built) — a `Member` can view discovered sites but cannot approve them, consistent with `MicrosoftTenant` connection management already being Admin-only (ADR-0012 §2). The admin is shown all `status: Discovered` sites for the tenant and selects a subset to approve; nothing is scanned until this explicit step completes.

### 3. Persisting approved sites

Requires extending `SharePointSite` with:

```
enum SharePointSiteStatus {
  Discovered   // found via Graph, not yet reviewed
  Approved     // explicitly approved by an Admin — eligible for scanning
  Removed      // no longer governed, whether by admin de-approval or because
               // the site vanished upstream — see §5 for why these collapse
               // into one state rather than two
}
```

- `SharePointSite.status: SharePointSiteStatus @default(Discovered)`
- `SharePointSite.approvedAt: DateTime?`
- `SharePointSite.approvedByUserId: String?` — FK to `User`, nullable, `onDelete: SetNull`, distinct relation name (e.g. `"SharePointSiteApprovedBy"`) — directly mirrors the already-established `MicrosoftTenant.consentGrantedByUserId` pattern (ADR-0007), giving the same audit-trail guarantee ("who approved this site, and when") for site-level governance that already exists for tenant-level consent.

This is a real, required schema change this ADR introduces — not implemented here, per your instruction, but called out explicitly so it isn't discovered as a surprise when Phase 5 coding starts.

### 4. Future rescans

`ScanJob` processing (ADR-0004, unchanged in its own architecture) queries only `SharePointSite` rows with `status: Approved` for the tenant being scanned — enforced as a query-level filter in the worker, not a Graph-permission-level restriction. This is the literal implementation of "only approved sites are scanned," and it's worth being precise that it's a **product policy boundary, not a cryptographic one**: the underlying Graph token can technically still read unapproved sites; our own business logic simply chooses never to ask. That distinction matters for how this gets described to customers' security teams — it's a meaningful, real safeguard, but it's not the same class of guarantee as a permission scope itself.

Discovery-refresh (checking for sites created in the tenant since the last discovery) is **on-demand only for MVP** — an admin explicitly re-runs discovery from the site-management screen — not a scheduled background process, consistent with ADR-0004's existing "no scheduled scans in MVP" decision. Introducing scheduled discovery here would mean inventing a new background-job concept this ADR doesn't need and ADR-0004 already deliberately deferred.

### 5. Adding / removing sites

**Adding**: a later discovery run may find sites that didn't exist (or weren't visible) before. These are persisted the same way as initial discovery — `status: Discovered` — and go through the exact same explicit admin-approval step. See §6 for why this is non-negotiable.

**Removing**: an admin can revoke approval for a previously-approved site (`status: Approved → Removed`). This is a **status transition, never a hard delete**. Hard-deleting a `SharePointSite` row would cascade-delete every `Document`, `HealthScore`, and `HealthIssue` scanned under it (per ADR-0007's cascade design) — destroying historical governance data the moment a customer reconsiders which sites should be *currently* governed, which directly undermines the audit/history value this product is supposed to provide. Future scans simply stop including a `Removed` site; its historical data remains queryable.

A site can also land in `Removed` because it no longer exists upstream (deleted in SharePoint, or no longer visible to the granted permissions) — collapsed into the same status as admin de-approval rather than a separate enum value, since the only thing this field needs to drive is "should this be scanned going forward," and the answer is identical either way. The *reason* is a detail for logging/audit purposes, not a distinct scanning-eligibility state.

### 6. Default behavior for new SharePoint sites

**Never auto-approved, under any circumstance** — this is the concrete, standing enforcement of the principle stated at the top of this ADR. A site discovered during initial onboarding and a site discovered six months later via a manual rescan are treated identically: `status: Discovered`, invisible to the scan pipeline, requiring the same explicit admin action before anything in it is ever read. There is no "auto-approve sites matching a pattern" or "auto-approve if the last discovery approved everything" shortcut — any such convenience feature would need its own explicit, separately-justified ADR, not a quiet default here.

### 7. Security implications

- Directly bounds the blast radius of what our product actually reads, independent of what the permission grant would technically allow — the core purpose of this ADR.
- Prevents accidental inclusion of sensitive sites (HR, legal, executive) the customer's Global Admin didn't specifically intend to expose when granting tenant-wide Graph consent — consent to install the app and consent to govern a specific site are treated as two separate, both-required decisions, made by potentially different people (a Global Admin grants consent; a governance-program Admin selects sites).
- The `approvedByUserId`/`approvedAt` audit trail is dual-purpose: it's operationally useful to us, and it's directly useful to the *customer's own* internal compliance/audit needs — a customer being asked "who authorized this tool to read the Legal site" now has a real, queryable answer.
- Worth being explicit in any security-review conversation that this is a product-policy safeguard layered on top of the permission grant, not a replacement for least-privilege permission scoping (ADR-0003) — both layers matter, neither substitutes for the other.

### 8. Enterprise trust model

Least privilege (ADR-0003: request only the Graph scopes actually needed) and least exposure (this ADR: read only what's been explicitly approved, even within what's technically permitted) together form the complete data-access trust story for this product. This is a genuine differentiator worth stating plainly in customer-facing security material, not just an internal implementation detail: **granting this app access to your tenant does not mean this app reads your whole tenant** — an enterprise customer's security team can verify that claim by checking exactly one thing, the `SharePointSite.status` column, which is a materially stronger and more auditable answer than "trust our code doesn't overreach."

---

## Tradeoffs

- Persisting every discovered site (not just approved ones) means `SharePointSite` will contain rows never intended for scanning, for potentially a long time if an admin never reviews them — acceptable; it's a small amount of inert data in exchange for a stable, queryable discovery view and a clean audit trail of what was *seen but not chosen*, which is itself useful governance information.
- On-demand-only rescanning for new sites means a genuinely new site can sit undiscovered indefinitely if no admin ever re-triggers discovery — an accepted MVP limitation matching ADR-0004's existing no-scheduling stance, not a new one introduced here.
- Collapsing "admin de-approved" and "vanished upstream" into one `Removed` status trades a small amount of diagnostic precision for a simpler enum and a single, unambiguous scanning-eligibility check — the right tradeoff given nothing in this product currently needs to distinguish the two operationally.

## Future Considerations

*(As originally written 2026-07-12 — see the 2026-07-20 amendment below for what was actually built and why.)*

- If real-world tenants routinely have large enough site counts that synchronous discovery via `apps/api` becomes slow or risks timeout, move discovery through the async queue (ADR-0004's existing infrastructure) rather than inventing new plumbing — flagged as a revisit trigger, not solved preemptively.
- Scheduled/automatic discovery-refresh is a natural v2 pairing with ADR-0004's already-deferred scheduled scans — should be designed together when that work starts, not separately.
- A future "bulk approve by pattern" admin convenience feature (e.g., approve all sites under a given path) is explicitly not decided here and would need its own ADR, per §6.

---

## Amendment (2026-07-20): Discovery Ownership Moves to `apps/worker`

### Why

A product/UX design review this session identified a real reliability gap in triggering discovery from the frontend (the implementation that shipped earlier in this same session): if an admin completes Microsoft admin consent, the server-side bootstrap succeeds, and the *browser* is the thing that calls the discover-sites endpoint next — closing the tab before that call completes leaves the tenant `Consented` with discovery never run and no automatic path to retry. This is exactly the class of problem `apps/worker`'s existing queue-based architecture (ADR-0004, ADR-0015 §1) already solves for scanning: decouple the operation from any single HTTP request's lifecycle, and the original ADR's own Future Considerations named this exact escape hatch (async queue for discovery) — just anticipating a different trigger (site-count scale) than the one that actually motivated it (onboarding reliability). Moving discovery into `apps/worker` also sidesteps a real NestJS module-graph problem discovered while implementing the frontend-triggered version: `SharePointSitesModule` already imports `AuthModule` (for its guards), so having `AuthModule`'s consent-callback controller import `SharePointSitesModule` back would create a circular module dependency. Living in a different app entirely (`apps/worker` already imports `packages/graph-client`, per ADR-0013) avoids that problem by construction, not by working around it.

One clarification on scope, since it's a natural question this amendment raises: **the "bulk approve" feature planned for a later implementation phase is not the "bulk approve by pattern" convenience this ADR's Future Considerations explicitly deferred.** That deferred feature meant auto-matching sites by a rule (e.g., "approve everything under `/sites/finance-*`") with no per-site admin decision. The planned bulk-approval work is explicit multi-select of already-discovered, already-visible sites batched into one request — every site still requires a specific admin's specific inclusion in that selection, satisfying §6's "never auto-approved" principle exactly as a series of individual clicks would; it is not a new decision this ADR needed to make room for.

### Mechanism

A new `DISCOVERY_QUEUE` (`packages/types`, same pattern as `SCAN_QUEUE`/`SCHEDULER_QUEUE`), one new `apps/worker` processor (`SiteDiscoveryProcessor`, mirroring `SchedulerProcessor`'s shape) consuming it. `POST /auth/consent-callback`'s bootstrap path (and the existing manual `POST /organizations/:id/discover-sites` endpoint, and the future reconnect path) all become **producers** onto this queue rather than executing discovery inline — discovery has exactly one execution path regardless of what triggered it, the same "scheduling is a producer, never a second execution path" discipline ADR-0015 §1 already established for scans.

`MicrosoftTenant` gains four fields to track the current discovery job's state (read by ADR-0017's `onboarding-status` endpoint as `discovery.status`):

```prisma
enum DiscoveryStatus {
  NotStarted
  Queued
  Running
  Completed
  Failed
}

model MicrosoftTenant {
  // ...existing fields...
  discoveryStatus      DiscoveryStatus @default(NotStarted)
  discoveryStartedAt   DateTime?
  discoveryCompletedAt DateTime?
  discoveryError       String?
}
```

One current-job's-worth of state per tenant, not a history table — matching how the manual on-demand rescan (§4, unchanged) only ever cares about the *latest* run's outcome, and keeping this an additive, minimal schema change rather than a new relation.

**These four fields represent the current discovery operation's state only. They are not discovery history and must not be read or written as an audit trail.** Each field is overwritten by the next discovery run — there is no record of *previous* runs once a new one starts, and nothing about "who triggered this" lives here at all (`discoveryStatus`/`discoveryError` describe *what the job did*, not *who asked for it*). Anything answering "when did discovery run and who triggered it, historically" is an `AuditLog` (ADR-0019) concern, not this one — `AuditLog` and these four fields serve genuinely different purposes and neither substitutes for the other: this is live operational state for one in-flight-or-most-recent job, `AuditLog` is the durable historical record.

### State transitions

```
NotStarted → Queued              (a discovery job is enqueued)
Queued     → Running              (the worker picks up the job)
Running    → Completed             (listSites succeeds, sites persisted)
Running    → Failed                (BullMQ's retries exhausted — see Failure handling)
Failed     → Queued               (manual re-trigger — see Recovery)
Completed  → Queued               (manual rediscovery — see Recovery)
```

`Queued → Queued` and `Running → Running` are not real transitions — they never happen, because the concurrency guard (below) prevents a second job from being enqueued whenever the stored `discoveryStatus` is already `Queued` or `Running`. The producer's enqueue attempt is a no-op in that case, not a state write, so these two cells are intentionally absent from the table rather than self-loops.

### Idempotency

`SharePointSitesService.discoverSites`'s existing logic is preserved unchanged in its core shape when it moves into the worker processor: it already builds a map of existing `SharePointSite` rows by `graphSiteId` and skips creating a duplicate for any site already known, which is the correct idempotent behavior for **new** sites regardless of how many times discovery re-runs. One refinement this amendment adds: when an already-known site's `siteUrl` or `displayName` differs from what Graph currently reports (a site renamed or moved upstream since the last run), those two fields are updated in place — **`status`, `approvedAt`, and `approvedByUserId` are never touched on an already-known row**, which is what makes approval preservation (below) hold. This is a small, additive change to the existing method, not a rewrite.

### Concurrency protection

**`MicrosoftTenant.discoveryStatus` in Postgres is the single source of truth for "is a discovery operation currently in flight for this tenant" — BullMQ's queue state is never consulted for this decision.** Two layers, deliberately not equal partners:

1. **Application-level guard (authoritative)**: before enqueueing, the producer checks `MicrosoftTenant.discoveryStatus` — if it's already `Queued` or `Running`, the enqueue is skipped (a no-op, not an error) rather than adding a second job. This is the exact same shape as `ScansService.triggerScan`'s existing "block a new scan while one is Queued/Running for this tenant" guard and `SchedulerProcessor`'s own "skip this tick if a scan is already in flight" check — both already-proven patterns in this codebase, just applied to discovery instead of scanning. This is the real guard; the decision is made from database state, full stop.
2. **Queue-level dedup (defense in depth, not a replacement)**: the job is additionally enqueued with a deterministic `jobId` derived from the tenant (e.g. `discovery-${microsoftTenantId}`), the same technique `SchedulerProcessor`'s own heartbeat registration already uses (`jobId: 'scheduler-heartbeat'`) for singleton-job guarantees. This catches a narrow race the database check alone can't (two nearly-simultaneous producer calls reading `discoveryStatus` before either has written `Queued`) — but it is a backstop against duplicate *queue entries*, not a substitute for the database guard: BullMQ's own job state is never read to decide whether to enqueue, only used as a second independent line of defense against the specific race condition above.

### Failure handling

Transient Microsoft Graph failures (429/503/504) are already retried automatically by the Graph SDK's built-in `RetryHandler` inside `packages/graph-client` (ADR-0013 §3) — no new retry logic needed at that layer. Above that, the `DISCOVERY_QUEUE` job itself is registered with `defaultJobOptions: { attempts: 3, backoff: exponential }`, the exact same producer-side options already established for `SCAN_QUEUE` in Phase 5 — a small number of whole-job retries in case of a failure the Graph-client layer's own retry didn't absorb (e.g., a worker crash mid-run, not just an HTTP-level throttle). Only once BullMQ's own retries are exhausted does the processor set `discoveryStatus: Failed`, `discoveryCompletedAt: now`, and `discoveryError` to the failure's message (not a full stack trace — matching `ScanJob.errorSummary`'s existing convention and `security.md`'s "never log sensitive data," since Graph error messages can occasionally echo request details).

### Recovery

The existing manual `POST /organizations/:id/discover-sites` endpoint (§4, Admin-only, unchanged) is the recovery path — it always enqueues a fresh discovery job regardless of the tenant's current `discoveryStatus`, **except** when that status is already `Queued`/`Running` (the concurrency guard above, which correctly blocks a second concurrent attempt but must never block retrying after `Failed` or re-running after `Completed`). A successful retry's processor run ends in `discoveryStatus: Completed`, exactly as a first-time success would — there is no separate "recovered" state, `Failed → Completed` is not a distinguished transition from `NotStarted → Completed`.

### Implementation Note (2026-07-25): discovery mechanism replaced, discovery policy unchanged

Live testing against a real Microsoft 365 tenant found `packages/graph-client`'s `listSites()` — at the time backed by Graph's search endpoint — could silently miss sites the app's own `Sites.Read.All` grant could otherwise read directly: a private site excluded from the tenant's search index, and a newly created site whose search index hadn't yet caught up. `listSites()` now calls `GET /sites/getAllSites` internally instead (see ADR-0013's own implementation note for the full investigation and Microsoft documentation citations) — a direct site-collection enumeration with no search-index dependency, requiring the identical `Sites.Read.All` application permission already granted for every connected tenant.

**Nothing in this ADR's actual decision changes.** The flow is exactly as decided above: discover everything visible → persist as `SharePointSite{ status: Discovered }` → an Admin explicitly approves → only `Approved` sites are ever scanned. Only the Graph call underlying "discover everything visible" changed.

**One new, necessary exclusion, not a new kind of decision**: `getAllSites` also enumerates personal OneDrive sites (Graph's own `isPersonalSite` field) — outside this product's stated mission (governance of organizational SharePoint knowledge, not individual OneDrive storage) and never returned by the old search-based call. `apps/worker`'s `SiteDiscoveryProcessor` now skips any site where `isPersonalSite === true` before it ever reaches the database. This is deliberately **not** an instance of the "bulk approve/exclude by pattern" convenience §6 already rejected for v1 — `isPersonalSite` is an authoritative Graph field describing what the site *is*, not a guessed name/URL pattern describing what it *might be*. Consistent with that same principle, an unrecognized or tenant-system site with no such flag (e.g. the tenant's built-in Search Center, observed live) is **not** filtered — it is persisted as `Discovered` like any other site, and an Admin decides via the existing, unmodified approval step. No heuristic exclusion was introduced.

### Approval preservation

Already correctly satisfied by the existing `discoverSites` logic (see Idempotency above) and unchanged by this amendment: an already-`Approved` `SharePointSite` row is never reset to `Discovered` by a later discovery run, because the existing/rediscovered-row branch never writes to `status` at all, only (per the new idempotency refinement) to `siteUrl`/`displayName`. This holds for every trigger — first-time onboarding discovery, a manual admin-triggered rescan, and a failure-recovery retry all share the exact same code path, so there is only one place this guarantee needs to be true, not three.
