# ADR-0014: SharePoint Site Discovery and Customer Scan Scope

Date: 2026-07-12
Status: Accepted

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

Triggered automatically as the immediate next step after a `MicrosoftTenant` transitions to `Consented` (ADR-0012), within the same onboarding flow — no separate manual "start discovery" action needed, since discovery itself never exposes data, only *lists* what's visible. Implemented as a synchronous `apps/api` call to `packages/graph-client`'s `listSites(entraTenantId)` (ADR-0013), fully consumed (the async generator exhausted into a complete list) before responding — reasonable because site *counts* (hundreds to low thousands even for large enterprises) are far smaller than document counts, unlike scanning, which genuinely needs the async queue (ADR-0004). Flagged as an assumption to revisit if real-world site counts prove otherwise (see Future Considerations), not preemptively engineered around.

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

- If real-world tenants routinely have large enough site counts that synchronous discovery via `apps/api` becomes slow or risks timeout, move discovery through the async queue (ADR-0004's existing infrastructure) rather than inventing new plumbing — flagged as a revisit trigger, not solved preemptively.
- Scheduled/automatic discovery-refresh is a natural v2 pairing with ADR-0004's already-deferred scheduled scans — should be designed together when that work starts, not separately.
- A future "bulk approve by pattern" admin convenience feature (e.g., approve all sites under a given path) is explicitly not decided here and would need its own ADR, per §6.
