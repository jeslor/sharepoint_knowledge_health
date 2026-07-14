# Local Acceptance Testing (LAT) Plan

**Purpose**: validate the complete, Phase-9-hardened product against a real Microsoft 365
tenant, running entirely locally (Postgres + Redis via `docker-compose.yml`, `apps/api`/
`apps/worker`/`apps/web` via `pnpm dev`), before any cloud deployment. This document is
grounded in the system as actually implemented — every route, field, and business rule
below was verified against the current code, not assumed from design docs.

**How to use this document**: work top to bottom. Section 1 lists confirmed gaps that
change *how* you must execute later sections — read it before starting. Section 6 is a
trackable checklist mirroring every test case in Section 5.

---

## 1. Critical known gaps affecting how you must run this LAT

These were found by reviewing the actual implementation, not encountered by chance. Each
one changes how a later test case must be executed. None of these are being fixed as part
of this exercise — they are documented here so LAT isn't derailed re-discovering them.

### 1.1 No path exists to approve a second (`PendingApproval`) user

When anyone other than an organization's first user signs in, they are auto-provisioned as
`role: Member, status: PendingApproval` (`packages/database/src/onboarding.ts`) and denied
all API access (`TenantContextGuard` throws `403 Account pending approval`). **There is no
API endpoint and no web UI screen anywhere in the codebase that transitions a user from
`PendingApproval` to `Active`.** ADR-0012 itself flags this as a known, deferred UX gap
("an approval inbox/screen for Admins... doesn't exist yet").

**Workaround for LAT**: to test with a second user, manually promote them via Prisma
Studio or direct SQL after their first sign-in creates the row:
```sql
UPDATE "User" SET status = 'Active' WHERE email = 'second-user@yourtenant.onmicrosoft.com';
```
Test multi-user scenarios (role permissions, assignment, audit "actor") with this
workaround. Track it as a real product gap, not a LAT blocker to route around silently.

### 1.2 No web UI exists for SharePoint site discovery or approval

`apps/web`'s nav (`apps/web/src/app/dashboard/layout.tsx`) has exactly four links:
Overview, Documents, Scans, Governance. There is no "Sites" page. The web app only ever
*reads* `GET /organizations/:id/sharepoint-sites` (to populate a filter dropdown on the
Documents page) — it never calls `POST .../discover-sites` or `PATCH .../approve`. Since
**no site can ever be scanned until an Admin explicitly approves it** (ADR-0014, enforced
in `apps/worker`'s collector), this is not optional groundwork — every downstream test in
this plan depends on it.

**Workaround for LAT**: discovery and approval must be driven directly against the API
(curl, Postman, or an `.http` file) as an Admin-role user's bearer token:
```
POST /organizations/{orgId}/microsoft-tenants/{tenantId}/discover-sites
GET  /organizations/{orgId}/sharepoint-sites
PATCH /organizations/{orgId}/sharepoint-sites/{siteId}/approve
```
Getting a token: sign into `apps/web` once, open browser devtools → Application →
Session Storage, and copy the MSAL-cached id token; or acquire one via a small MSAL
node/curl script against your test app registration.

### 1.3 `ReviewStatus` always fails, and "Healthy" is currently unreachable

`apps/worker`'s `scoreTenantDocuments` hardcodes `hasReviewDate: false` for every document
(no SharePoint "review due date" integration exists yet — `packages/scoring/src/rules/
review-status.ts`). This means **every single document, regardless of quality, scores 0
on ReviewStatus and gets a `RequiresReview` issue.** Given the weights
(`packages/scoring/src/config.ts`: Freshness .30 / Ownership .20 / ReviewStatus .15 /
Metadata .15 / Duplication .10 / Age .10), the maximum composite score any document can
achieve today is **85** (a perfect score on every other criterion), and the `Healthy` band
requires ≥90. **No document will ever land in the `Healthy` band in this build.** Do not
report this as a scoring bug during LAT — verify the *math* is internally consistent
(every non-ReviewStatus criterion scoring correctly, composite correctly weighted) rather
than expecting to see a `Healthy` document.

### 1.4 A worker crash mid-scan permanently wedges that tenant's scanning

`ScanJob.status` is set to `Running` at the top of `DocumentCollectorProcessor.process()`
and only ever transitions to `Completed`/`Failed` at the *end* of a successful run.
BullMQ's own stalled-job detection will eventually mark the underlying job execution as
failed if the worker process dies mid-job, but `@OnWorkerEvent('failed')` only **logs** —
nothing updates the `ScanJob` row. Since both the manual-trigger guard
(`ScansService.triggerScan`) and the scheduler's guard check for
`status: { in: ['Queued', 'Running'] }`, a `ScanJob` stuck at `Running` **permanently
blocks every future scan** (manual or scheduled) for that Microsoft tenant.

**Workaround if hit during LAT** (this is exactly Test Case 6.4 below — deliberately
trigger it):
```sql
UPDATE "ScanJob" SET status = 'Failed', "completedAt" = now(), "errorSummary" = 'Manually recovered after worker crash (LAT)' WHERE id = '...';
```

### 1.5 The web UI does no client-side role gating

No component checks `user.role` before rendering a mutation control (trigger-scan button,
scan-schedule settings, track-in-governance button — confirmed by source inspection: zero
references to `role`/`Admin`/`GovernanceManager` in any of these components). Every button
is visible to every authenticated user regardless of role; enforcement is 100%
server-side (`RolesGuard` → `403`). Expect a `Member` or `GovernanceManager` user to be
able to *click* an Admin-only action and get a raw API error — Section 5.15 (Permissions)
tests specifically that this fails safely (no crash, a legible error), not that the
button is hidden.

---

## 2. Environment prerequisites

- **Local infrastructure**: `docker-compose up -d` (Postgres 16, Redis 7) — confirm both
  healthy (`docker compose ps`).
- **Apps**: `pnpm dev` from repo root, or individually per `apps/*`. Confirm `apps/api`
  logs `Nest application successfully started` with no `Invalid environment
  configuration` exit, and `apps/worker` logs `Scheduler heartbeat registered`.
- **Real Microsoft 365 tenant**: a genuine Entra ID tenant you control (not `common`),
  with at least Global Admin access for the one-time admin-consent grant.
- **Entra App Registration** (see `docs/architecture/deployment.md` for the authoritative
  list): multi-tenant, SPA redirect URI matching `apps/web`'s local origin
  (`http://localhost:3000` unless overridden), API permissions `Files.Read.All` +
  `Sites.Read.All` (application, admin-consented).
- **`.env`**: `DATABASE_URL`, `REDIS_URL`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, plus
  `apps/web`'s `NEXT_PUBLIC_*` build-time vars pointed at the same app registration.
- **A way to issue direct API calls** for §1.2's workaround: curl, Postman, or an `.http`
  file with a captured bearer token.
- **A way to backdate document timestamps for realistic aging scenarios.** SharePoint's
  own web UI always sets `createdDateTime`/`lastModifiedDateTime` to "now" on
  upload/edit — there is no browser-UI way to make a freshly-uploaded test file look
  90+ days old. Use Graph Explorer or PnP PowerShell (`Set-PnPListItem`) to backdate
  `Created`/`Modified` on specific test files after upload, or accept that
  Freshness/Age scenarios must be tested with **real, naturally-aged content** already
  in the tenant (a pre-existing document library) rather than freshly created files.

---

## 3. Test data profiles

Since there is no seed script for application data (only `packages/database`'s own
automated-test fixtures — confirmed, no `db:seed` script exists anywhere), all LAT data
must be real content in the connected SharePoint tenant. Build up through these four
tenant profiles in order; each is a superset of the previous one's *scenarios*, not
necessarily its literal files.

### 3.1 Empty tenant
- 1 SharePoint site, connected and approved, containing **zero documents** (or a
  document library with only folders, no files).
- **Purpose**: every "zero state" in the product — dashboard, trends, governance
  summary, analytics, document list — must render sanely with nothing to show, not
  crash or show `NaN`/`undefined`.

### 3.2 Small tenant (~1 site, 15–25 documents)
Deliberately hand-picked to hit every scoring rule at least once:
| # | Characteristic | Exercises |
|---|---|---|
| 3–5 | Recently modified (< 30 days), normal names, known author | Freshness=100, Metadata=100 |
| 2 | Not modified in ~300 days (real aged content, or backdated) | Freshness NeedsAttention |
| 2 | Not modified in ~500+ days | Freshness RequiresReview |
| 2 | Created ~1000+ days ago (regardless of last-modified) | Age NeedsAttention/RequiresReview, independent of Freshness |
| 1 | Named exactly `Untitled.docx` | Metadata RequiresReview |
| 1 | Named `Copy of Vendor List.xlsx` | Metadata RequiresReview |
| 1 | Named `Document3.xlsx` | Metadata RequiresReview |
| 2 | Same file name **and** same byte size, uploaded to **two different sites** in the same tenant | Duplication flagged cross-site (scoring is tenant-scoped, not per-site — see 5.9) |
| 2 | Uploaded via a path that drops `createdBy` (e.g. certain sync-client uploads, or a file moved between libraries) | Ownership RequiresReview (no identifiable owner) |
| 1 | Authored by someone who is a registered product `User` but whose account is `Deactivated` | Ownership NeedsAttention (all resolvable owners inactive) |
| Remaining | Normal, healthy-looking files | Composite ceiling of 85 (see §1.3) |

### 3.3 Medium tenant (~3–5 sites, 200–500 documents)
- At least one site left in `Discovered` (never approved) — confirms it's silently
  excluded from every scan and every dashboard number.
- At least one site `Approved` then later `Revoke`d — confirms it stops being scanned
  going forward but its already-collected documents/history aren't deleted.
- A realistic folder-nesting depth (SharePoint sites with 3+ levels of subfolders) to
  exercise Graph pagination (`listDocuments`'s async iterator) beyond a single page.
- Enough volume that a manual scan takes at least tens of seconds, so `ScanJob`
  progress fields (`currentSiteName`, `sitesCompleted`/`totalSites`) are observable
  mid-flight rather than jumping straight to `Completed` (see 5.8).

### 3.4 Large tenant (2,000+ documents across 10+ sites)
- Purpose-built to probe performance/scale assumptions flagged in
  `docs/architecture/operations.md` — specifically `GovernanceIssuesService.getSummary()`
  and `GovernanceAnalyticsService.getAnalytics()`'s in-memory aggregation.
- Time a full scan end-to-end; time `GET .../governance/summary` and
  `GET .../governance/analytics` response latency before and after the scan.
- Generate 50+ `GovernanceIssue` rows (via repeated tracking) to exercise pagination on
  `GET .../governance/issues` and `GET .../governance/activity` beyond one page
  (`pageSize` max is 100 — verify a `page=2` request works correctly).

---

## 4. Areas most likely to contain real-world bugs

Ranked by where implementation complexity, external-system unpredictability, or thin
test coverage overlap:

1. **Graph API pagination and item edge cases** (`packages/graph-client`'s `listSites`/
   `listDrives`/`listDocuments` async iterators) — real tenants have file types, sharing
   links, and sync-client-created items with metadata shapes automated tests can't
   fully anticipate (e.g. missing `createdBy`, unusual `parentReference.path` values,
   OneNote/`.aspx` items with no `file` facet at all).
2. **The Duplication rule's tenant-wide, exact-match scope** — real tenants often have
   *near*-duplicates (same content, different name/size after a re-save) that will
   **not** be flagged (by design, ADR-0005), which testers unfamiliar with the exact-match
   rule may initially read as a bug.
3. **Scan concurrency guard interacting with a real worker crash** — §1.4 above. This is
   the single highest-value scenario to deliberately reproduce during LAT precisely
   because it's easy to trigger by accident (killing `apps/worker` with Ctrl+C mid-scan)
   and easy to mistake for "the scan just takes a long time" if you don't check
   `ScanJob.status` directly.
4. **The scheduler's tenant-resolution ambiguity check** — an organization that connects
   a *second* `MicrosoftTenant` (however that's arranged) will cause every scheduled tick
   for that org to silently skip with a `WARN` log (`expected exactly 1 connected
   Microsoft tenant, found 2`) — easy to miss without watching worker logs.
5. **Owner "active user" resolution depends on email matching a registered `User` row**
   — an author whose SharePoint email doesn't exactly match their product-login email
   (common with guest accounts, aliases, or a difference in casing) will be treated as
   unresolvable (`isActiveUser: null`), not as inactive — verify this distinction rather
   than assuming any non-owner is "inactive."
6. **`GovernanceIssue` uniqueness on `(documentId, issueType)`** — re-tracking the same
   issue type on the same document after it was `Resolved` is not a fresh row; verify the
   product's actual behavior (a second `POST .../issues` for an already-tracked type is
   expected to `409`, per `governance-issues.service.ts`) matches what the UI does when a
   user tries to re-track something already tracked.
7. **CORS / origin config drift** between `apps/web`'s actual local port and
   `WEB_APP_ORIGIN` — if `apps/web` isn't on exactly `http://localhost:3000` (e.g. Next
   picked a different port because 3000 was in use), every API call will fail as a CORS
   error that looks like a network failure in the browser console, not an auth error.
8. **Large-tenant in-memory aggregation** (§3.4) — the most likely place raw performance
   (not correctness) bugs surface first, per `docs/architecture/operations.md`'s
   already-documented risk.

---

## 5. Feature test plans

Each test case: **Preconditions → Steps → Expected Results → Failure Scenarios**. Routes
cited are exact (`apps/api/src/**/*.controller.ts`).

### 5.1 Authentication

**5.1.1 — First-time sign-in bootstraps a brand-new organization**
- *Preconditions*: a Microsoft 365 tenant that has never connected to this product before;
  Global Admin has completed admin consent for the app registration's `Files.Read.All`/
  `Sites.Read.All` scopes.
- *Steps*: 1) Visit `apps/web`, click sign in. 2) Complete the Microsoft login/consent
  flow. 3) Confirm you land on `/dashboard`.
- *Expected*: a new `Organization`, `MicrosoftTenant` (`status: Consented`), and `User`
  (`role: Admin, status: Active`) are created in one transaction
  (`provisionOrganizationFromConsent`). `GET /auth/me` returns your `role: Admin` and a
  real `organizationId`.
- *Failure scenarios*: partial creation on a mid-transaction crash (verify via DB — should
  be structurally impossible, it's one `$transaction`); signing in twice in a row must
  **not** create a second organization (idempotent per ADR-0012 — verify by re-signing-in
  and confirming the same `organizationId`/`userId` come back, `kind: 'existing'`).

**5.1.2 — Expired/invalid token is rejected**
- *Steps*: call any protected endpoint with a malformed/expired bearer token.
- *Expected*: `401 Unauthorized`, no stack trace, no internal detail leaked.
- *Failure scenarios*: a token from a *personal* Microsoft account (not work/school) must
  be rejected — the JWKS endpoint used is tenant-`/organizations/`-scoped, not `/common/`.

**5.1.3 — Second person from the same (already-connected) tenant signs in**
- *Steps*: a different real user in the same M365 tenant signs into `apps/web`.
- *Expected*: a new `User` row, `role: Member, status: PendingApproval`. `GET /auth/me`
  succeeds (identity resolved) but every other protected route returns `403 Account
  pending approval`.
- *Failure scenario*: **this is where §1.1 applies** — there is no way to unblock this
  user through the product. Use the SQL workaround, then re-verify they now have normal
  `Member` access.

### 5.2 Organization onboarding

**5.2.1 — Consent callback is the only path that creates a new Organization**
- *Steps*: attempt to reach any *other* protected endpoint with a token whose `tid` has
  never been seen before (no `MicrosoftTenant` row exists for it).
- *Expected*: `403 Organization not connected` (`TenantContextGuard`) — **not** a silently
  auto-created organization. Only `POST /auth/consent-callback` can bootstrap one.
- *Failure scenarios*: confirm this holds even for routes with no `RolesGuard` at all
  (i.e. it's `TenantContextGuard` itself refusing, not a role check).

### 5.3 Microsoft tenant connection

**5.3.1 — Tenant shows `Consented` immediately after onboarding**
- *Expected*: `MicrosoftTenant.status: 'Consented'`, `consentGrantedAt` set,
  `consentGrantedByUserId` pointing at the bootstrapping Admin.

**5.3.2 — Revoked tenant (manual DB test, no product UI to revoke exists)**
- *Steps*: set a `MicrosoftTenant.status` to `Revoked` directly in the DB.
- *Expected*: `triggerScanForOrganization`'s tenant-resolution only looks for `Consented`
  tenants — a `Revoked` one is invisible to it, correctly producing `404 No connected
  Microsoft tenant`.

### 5.4 SharePoint discovery

*(Requires the §1.2 direct-API workaround.)*

**5.4.1 — Initial discovery lists real sites**
- *Steps*: `POST /organizations/:id/microsoft-tenants/:tenantId/discover-sites` as Admin.
- *Expected*: every SharePoint site your Graph app-only permissions can see comes back,
  each as `status: 'Discovered'`. Verify against the actual SharePoint admin center site
  list — counts should match (barring OneDrive-only or restricted sites, which
  `Sites.Read.All` may not surface — a real thing to verify, not assume).

**5.4.2 — Re-running discovery never resets an already-Approved site**
- *Steps*: approve a site (5.5.1), then call `discover-sites` again.
- *Expected*: the previously-Approved site comes back in the response still `Approved`
  (`existingByGraphSiteId` short-circuits — it's never re-created or reset to
  `Discovered`).
- *Failure scenario*: a site removed upstream in SharePoint entirely should simply stop
  appearing in the discovery response — it is **not** auto-marked `Removed`; verify this
  matches actual behavior (`discoverSites` only ever adds, never prunes) — a genuine gap
  to note if it surprises you, not a bug to "fix" during LAT.

### 5.5 Site approval

**5.5.1 — Approve a Discovered site**
- *Steps*: `PATCH /organizations/:id/sharepoint-sites/:siteId/approve` as Admin.
- *Expected*: `status: 'Approved'`, `approvedAt`/`approvedByUserId` set. Trigger a scan
  next (5.6) — only this site's documents are collected.
- *Failure scenarios*: attempt as a `Member` or `GovernanceManager` → `403` (Admin-only,
  §1.5 applies — the web UI has no button for this anyway per §1.2).

**5.5.2 — Revoke an Approved site**
- *Steps*: `PATCH .../sharepoint-sites/:siteId/revoke`.
- *Expected*: `status: 'Removed'`. Trigger a new scan — this site is no longer
  enumerated. Its previously-collected `Document` rows are **not** deleted or marked
  `Removed` themselves (only the *site* status changes) — verify this distinction:
  documents already in the dashboard persist with stale data, they don't disappear or
  get purged.

### 5.6 Manual scans

**5.6.1 — Trigger a scan for the org's one connected tenant**
- *Steps*: `POST /organizations/:id/scans` (no body) as Admin, with ≥1 Approved site.
- *Expected*: `201`, a `ScanJob` returned with `status: 'Queued'`, `triggerSource:
  'Manual'`, `triggeredByUserId` set to you.
- *Failure scenarios*: a second `POST` while the first is still `Queued`/`Running` →
  `409 A scan is already in progress`; an org with zero `Consented` tenants → `404`; an
  org with more than one → `409` (must pass `microsoftTenantId` explicitly).

**5.6.2 — Non-Admin cannot trigger a scan**
- *Steps*: as `Member`/`GovernanceManager`, `POST .../scans`.
- *Expected*: `403`. Per §1.5, the web UI's "Trigger Scan" button is visible regardless —
  confirm clicking it as a non-Admin produces a legible in-app error, not a silent no-op
  or an unhandled exception in the browser console.

### 5.7 Scheduled scans

**5.7.1 — Create a Daily schedule**
- *Steps*: `POST /organizations/:id/scan-schedule` `{ "frequency": "Daily" }` as Admin (or
  via `apps/web`'s scan-schedule settings widget on the Scans page — this one **does**
  have a UI).
- *Expected*: `ScanSchedule` created, `enabled: true`, `nextRunAt` ≈ now + 24h.
- *Failure scenarios*: a second `POST` for the same org → `409` (use `PATCH`); invalid
  `frequency` value → `400`.

**5.7.2 — The scheduler tick actually fires** *(the most important scan-scheduling test — requires patience or a temporary code-free workaround)*
- *Steps*: with `apps/worker` running, either wait for the real 15-minute heartbeat with
  `nextRunAt` set in the near future, or directly set `ScanSchedule.nextRunAt` to a past
  timestamp via SQL to force the next tick to pick it up.
- *Expected*: worker logs `Scheduler tick: 1 due schedule(s) found` then `ScanSchedule ...
  triggered ScanJob ...`. A new `ScanJob` appears with `triggerSource: 'Scheduled'`,
  `triggeredByUserId: null`. `ScanSchedule.lastRunAt`/`nextRunAt` advance.
- *Failure scenarios*: a schedule due while a scan is already in-flight for that tenant →
  tick logs "Skipping ... a scan is already in progress", `nextRunAt` is **not**
  advanced (so the next tick retries) — verify this by triggering a manual scan right
  before a scheduled tick is due.

**5.7.3 — Disabling a schedule stops future ticks without deleting it**
- *Steps*: `PATCH .../scan-schedule` `{ "enabled": false }`.
- *Expected*: `findDueScanSchedules` excludes it going forward; `GET` still returns the
  schedule (not deleted).

### 5.8 Scan progress

**5.8.1 — Live progress fields update during a Running scan**
- *Precondition*: use the Medium tenant profile (3.3) so the scan takes long enough to
  observe.
- *Steps*: trigger a scan, then poll `GET /organizations/:id/scans/:scanId` every few
  seconds (or watch the Scan Detail page in `apps/web`, which has real UI for this).
- *Expected*: `totalSites` set once approved-site enumeration begins; `currentSiteName`
  changes as each site is processed; `sitesCompleted` increments monotonically;
  `currentSiteName` returns to `null` once the loop finishes, before final
  `Completed`/`Failed` status is set.
- *Failure scenarios*: a scan with zero Approved sites → completes near-instantly with
  `totalSites: 0`, not stuck/hung.

### 5.9 Health scoring

**5.9.1 — Composite score matches the weighted formula for a known document**
- *Steps*: pick one scored document from the Small tenant profile; independently compute
  each of the 6 sub-scores by hand from its real `sourceCreatedAt`/`sourceModifiedAt`/
  name/owners against the rules in §1.3, then compare to the `HealthScore` row.
- *Expected*: `compositeScore` = `round(0.30·Freshness + 0.20·Ownership + 0.15·
  ReviewStatus(always 0) + 0.15·Metadata + 0.10·Duplication + 0.10·Age)`, and matches your
  hand calculation exactly (deterministic, no randomness).
- *Failure scenarios*: confirm `healthBand` never comes back `Healthy` (§1.3); confirm a
  `HealthIssue` row exists for every sub-score below 70, with the correct severity split
  at 40.

**5.9.2 — Duplication is tenant-wide, not per-site**
- *Steps*: use the two identically-named/-sized files uploaded to two *different* sites
  (3.2). Run a scan.
- *Expected*: both documents get a Duplication issue, even though they're on different
  sites — `scoreTenantDocuments` groups by `(name, sizeBytes)` across the whole tenant's
  active documents, not per site.

**5.9.3 — A rescan updates existing documents, doesn't duplicate them**
- *Steps*: run a second scan with no changes to SharePoint content.
- *Expected*: `Document` row count unchanged (upserted by `(siteId, graphItemId)`); a new
  `HealthScore` row is created per document (scores are immutable, one per scan) but
  `Document.currentHealthScoreId` now points at the newest one.

**5.9.4 — A document deleted from SharePoint is marked `Removed`, not deleted**
- *Steps*: delete a test file from SharePoint, rescan.
- *Expected*: the corresponding `Document.status` becomes `Removed`; it disappears from
  the active document list/dashboard but its history is retained.

### 5.10 Historical snapshots

**5.10.1 — A snapshot is written only for a `Completed` scan**
- *Steps*: 1) Run a normal successful scan. 2) Separately, force a `Failed` scan (e.g.
  scan a tenant whose `MicrosoftTenant` row you've broken/deleted mid-flight, or revoke
  Graph consent beforehand).
- *Expected*: `HealthSnapshot` exists for (1), not for (2). `HealthSnapshot.scanJobId` is
  unique — never more than one per scan.

### 5.11 Trends

**5.11.1 — `GET .../health-trends` returns chart-ready points**
- *Precondition*: at least 3 completed scans spread over time (may need to manually
  backdate `HealthSnapshot.capturedAt` via SQL to simulate a real multi-day history
  within a single LAT session).
- *Steps*: `GET /organizations/:id/health-trends?days=30` (default 30; range 1–365).
- *Expected*: points ordered oldest→newest, each with `averageHealthScore`,
  `criticalIssuesCount`, `warningIssuesCount`, `totalDocumentsScanned`.
- *Failure scenarios*: `days=0` or `days=400` → `400`; `days=abc` → `400`; a brand-new
  org with zero snapshots → `200` with an empty `points` array, not an error.

**5.11.2 — Scan comparison highlights new/resolved issues correctly**
- *Steps*: `GET /organizations/:id/scans/:scanId/comparison` for the second-ever scan.
- *Expected*: `previousScanId` set, `scoreChange`/`criticalIssuesChange`/etc. computed
  from the two snapshots, `newIssues`/`resolvedIssues` diffed by `(documentId,
  criterion)`.
- *Failure scenarios*: the *first-ever* scan for an org → all fields `null`/empty, not a
  404 or crash (deliberately null-friendly).

### 5.12 Governance

**5.12.1 — Track a currently-detected issue**
- *Steps*: `POST /organizations/:id/governance/issues` `{ documentId, issueType }` for a
  document with a real, currently-detected `HealthIssue` of that type, as Admin or
  GovernanceManager.
- *Expected*: `201`, `GovernanceIssue` created with `status: 'Open'`, severity copied from
  the matching `HealthIssue`. A `GovernanceActivity` row (`IssueCreated`) is written.
- *Failure scenarios*: `issueType` not currently detected on that document → `404`;
  document never scored yet → `404`; already-tracked `(documentId, issueType)` pair →
  `409` (use `PATCH`, don't re-`POST`).

**5.12.2 — Status transitions follow the strict one-step graph**
- *Steps*: attempt `Open → Resolved` directly (skipping `InProgress`) via `PATCH`.
- *Expected*: `409 Cannot transition a governance issue from Open to Resolved` — the only
  allowed edges are `Open→InProgress`, `InProgress→Resolved`, `Resolved→Open`. This is a
  deliberate, documented restriction — **not a bug** if you hit it; verify the UI
  surfaces this as a sane error rather than a silent failure.
- *Expected (valid path)*: `Open→InProgress→Resolved` succeeds at each step;
  `resolvedAt` set only on the transition into `Resolved`, cleared back to `null` on
  `Resolved→Open`.

**5.12.3 — Assignment requires an Active user in the same organization**
- *Steps*: `PATCH .../issues/:issueId` `{ assignedUserId: <id> }` for a user who is
  `PendingApproval` or `Deactivated`.
- *Expected*: `400 Cannot assign a governance issue to an inactive user`.
- *Failure scenarios*: `assignedUserId` from a *different* organization entirely → `400`
  (tenant isolation enforced even on this write path).

**5.12.4 — Resolving an issue doesn't require the underlying HealthIssue to still exist**
- *Steps*: fix the underlying problem in SharePoint (add an owner, rename a placeholder
  file), rescan, then resolve the still-open `GovernanceIssue` for that now-fixed
  document.
- *Expected*: this succeeds — resolution is a human action, independent of the
  scan-derived evidence. Separately, confirm the issue detail view shows some "no longer
  detected in the latest scan" signal (a read-time derived flag, never stored) if the UI
  surfaces it — verify against the actual UI, don't assume it does.

### 5.13 Ownership

**5.13.1 — Manual ownership assignment survives a rescan**
- *Steps*: `POST /organizations/:id/documents/:documentId/owners` `{ displayName, email
  }` (Admin/GovernanceManager) to manually assign an owner. Rescan.
- *Expected*: the manual `DocumentOwner` (`source: 'ManualAssignment'`) is untouched by
  the rescan — only `source: 'GraphMetadata'` rows are deleted/recreated by the worker
  (ADR-0016 §4.2). Both a manual and a Graph-derived owner can coexist on one document.

**5.13.2 — Removing an owner**
- *Steps*: `DELETE .../documents/:documentId/owners/:ownerId`.
- *Expected*: `204`. Verify a subsequent rescan does **not** resurrect a manually-deleted
  `GraphMetadata` owner if the underlying SharePoint author metadata hasn't changed —
  confirm actual behavior here since `syncOwner` unconditionally recreates
  `GraphMetadata` rows from Graph's `createdBy` on every scan (this is expected: deleting
  a Graph-sourced owner is not "durable" the way a manual removal isn't either — verify
  which one you're actually testing).

### 5.14 Audit history

**5.14.1 — Every governance action produces exactly one `GovernanceActivity` row**
- *Steps*: perform one of each: create an issue, assign it, change its assignee, change
  its status, update resolution notes, resolve it, reopen it, assign an owner, remove an
  owner.
- *Expected*: `GET .../governance/activity` (org-wide) and `GET .../governance/issues/
  :issueId/activity` (per-issue) both show a row per action, correct `activityType`,
  human-readable `previousValue`/`newValue`, correct `actorUserId`.
- *Failure scenarios*: confirm there is genuinely no update/delete path for this data
  anywhere (append-only, by design) — attempt to find any mutation endpoint for
  `/activity` and confirm none exists (there shouldn't be one).

**5.14.2 — Pagination on activity/issue lists**
- *Precondition*: Large tenant profile (3.4), 50+ activity rows.
- *Steps*: `GET .../governance/activity?page=1&pageSize=20`, then `page=2`.
- *Expected*: correct, non-overlapping pages; `pageSize` > 100 → `400`.

### 5.15 Analytics

**5.15.1 — Analytics filters combine correctly**
- *Steps*: `GET .../governance/analytics?since=<date>&status=Resolved&severity=
  RequiresReview`.
- *Expected*: results reflect only issues matching *all* provided filters (AND, not OR).
  Invalid `since`/`until` (unparseable date) → `400`; invalid `status`/`severity`/
  `issueType` enum value → `400`.

**5.15.2 — Analytics on the Large tenant profile responds in reasonable time**
- *Steps*: time the same request against the Large profile (3.4) vs. Small (3.2).
- *Expected*: latency should scale sub-linearly-ish with issue count, not explode — if it
  does degrade sharply, this confirms the already-documented in-memory-aggregation risk
  (`docs/architecture/operations.md`) rather than a new finding; record actual numbers.

### 5.16 Permissions

**5.16.1 — Full role × endpoint matrix**
Verify each cell (✅ = allowed, ❌ = `403`):

| Endpoint | Admin | GovernanceManager | Member |
|---|---|---|---|
| Discover/approve/revoke sites | ✅ | ❌ | ❌ |
| Trigger/schedule scans | ✅ | ❌ | ❌ |
| Create/update governance issue, assign/remove owner | ✅ | ✅ | ❌ |
| View documents/scans/health/trends/governance/analytics (all `GET`s) | ✅ | ✅ | ✅ |

- *Failure scenarios*: per §1.5, every ❌ cell must be tested by actually clicking the
  relevant `apps/web` control as that role (not just calling the API directly) to confirm
  the resulting error is legible in-browser.

### 5.17 Multi-tenant isolation

**5.17.1 — Cross-organization access is rejected at the route level**
- *Preconditions*: two fully separate Organizations (two different LAT sign-ups, or a
  second one via a second M365 tenant/test account).
- *Steps*: as a User in Org A, call any `/organizations/:id/...` route with Org B's `id`.
- *Expected*: `403 Organization mismatch` (`OrganizationAccessGuard`) — before the
  controller/service even runs.
- *Failure scenarios*: confirm this holds for **every** controller, not just one —
  spot-check documents, scans, governance, health-trends, scan-schedule.

**5.17.2 — No data leakage even with a correct `:id` but crafted body/query IDs**
- *Steps*: as an Org A Admin (correct `:id` in the URL), attempt to assign a governance
  issue to Org B's `assignedUserId`, or fetch Org B's `documentId` via `/documents/
  :documentId`.
- *Expected*: `400`/`404` — `createTenantContext(organizationId)` scopes every query, so
  an Org B row is simply invisible, never returned or written against.

### 5.18 Error handling

**5.18.1 — Malformed input returns `400` with a clear message, not a `500`**
- *Steps*: send invalid enum values, out-of-range pagination, non-ISO dates, negative
  scores, etc. across every query-parsing controller (documents, governance issues,
  governance activity, governance analytics, health-trends).
- *Expected*: `400` with a specific, actionable message (see the exact validation logic
  in each controller — every case is hand-validated, not generic).

**5.18.2 — Not-found resources return `404`, not a crash**
- *Steps*: request a well-formed but nonexistent `documentId`/`scanId`/`issueId`/`siteId`.
- *Expected*: `404` in every case.

**5.18.3 — No secret ever appears in a response or log**
- *Steps*: trigger a scan against a tenant with an intentionally-revoked/expired Graph
  consent (force a Graph auth failure), inspect the resulting `ScanJob.errorSummary` and
  worker logs.
- *Expected*: no `ENTRA_CLIENT_SECRET`, token, or connection string ever appears, even in
  an error path.

### 5.19 Recovery scenarios

**5.19.1 — Worker crash mid-scan (deliberately reproduce §1.4)**
- *Steps*: trigger a scan against the Medium tenant profile (long enough to have time to
  act). Mid-flight (`ScanJob.status: 'Running'`, some `sitesCompleted` > 0), kill
  `apps/worker` (`Ctrl+C` or `kill -9`).
- *Expected*: `ScanJob` remains `status: 'Running'` forever. A new manual trigger for the
  same tenant → `409 A scan is already in progress` — **permanently**, until manually
  fixed. Restarting `apps/worker` does **not** self-heal this specific `ScanJob` row (it
  isn't re-picked-up automatically once BullMQ has given up on the underlying job).
- *Recovery*: apply the SQL from §1.4, confirm a new scan can then be triggered normally.

**5.19.2 — Redis unavailable**
- *Steps*: stop the local Redis container while `apps/api` is running. Hit
  `GET /health/ready`.
- *Expected*: `503`, body `{ status: 'degraded', checks: { redis: 'error', database:
  'ok' } }`. Dashboard *read* paths (documents, health, governance, analytics) should
  still work — they never touch Redis. Attempting to trigger a scan should fail
  gracefully (not hang indefinitely).

**5.19.3 — Postgres unavailable**
- *Steps*: stop the local Postgres container. Hit `GET /health/ready`, then any data
  route.
- *Expected*: `/health/ready` → `503`, both checks `error`. Every data route fails
  (expected — there's no fallback), but as a clean `5xx`, not a hang or an unhandled
  exception with a leaked stack trace.

**5.19.4 — Partial scan failure (one bad site doesn't abort the whole scan)**
- *Steps*: approve a site whose Graph access will fail mid-scan (e.g. revoke access to
  just that one site if your tenant setup allows it, or approve a site ID that's since
  been deleted upstream).
- *Expected*: that site's failure is logged and counted in `documentsFailed`/
  `errorSummary`, but **other approved sites in the same scan still complete
  successfully** — confirmed by `worker-pipeline.md`'s per-site try/catch isolation.

---

## 6. Manual testing checklist

Copy this into an issue tracker or check off directly in this file as you go.

### Setup
- [ ] Local Postgres + Redis running and healthy
- [ ] `apps/api`, `apps/worker`, `apps/web` all boot cleanly, no env validation failures
- [ ] Real M365 tenant connected, admin consent granted
- [ ] Bearer-token workaround ready for §1.2's direct API calls
- [ ] Empty / Small / Medium / Large tenant content profiles prepared (§3)

### Authentication (5.1)
- [ ] 5.1.1 First sign-in bootstraps a new org, is idempotent on re-sign-in
- [ ] 5.1.2 Invalid/expired/personal-account tokens rejected
- [ ] 5.1.3 Second user → PendingApproval, blocked until manual DB promotion

### Organization onboarding (5.2)
- [ ] 5.2.1 Only the consent-callback route can bootstrap a new org

### Microsoft tenant connection (5.3)
- [ ] 5.3.1 Tenant shows Consented immediately after onboarding
- [ ] 5.3.2 Revoked tenant excluded from scan-trigger resolution

### SharePoint discovery (5.4)
- [ ] 5.4.1 Discovery lists real sites matching SharePoint admin center
- [ ] 5.4.2 Re-discovery never resets an Approved site; removed-upstream sites aren't auto-pruned

### Site approval (5.5)
- [ ] 5.5.1 Approve a site; non-Admins get 403
- [ ] 5.5.2 Revoke a site; its historical documents persist

### Manual scans (5.6)
- [ ] 5.6.1 Trigger succeeds; concurrent trigger → 409; 0/2+ tenants → 404/409
- [ ] 5.6.2 Non-Admin blocked server-side; web UI shows a legible error

### Scheduled scans (5.7)
- [ ] 5.7.1 Create a schedule; duplicate → 409
- [ ] 5.7.2 Tick actually fires and creates a Scheduled ScanJob; in-flight tick is skipped and retried next cycle
- [ ] 5.7.3 Disabling stops future ticks without deleting the schedule

### Scan progress (5.8)
- [ ] 5.8.1 Live progress fields update correctly mid-scan; 0-site scan completes instantly

### Health scoring (5.9)
- [ ] 5.9.1 Hand-verified composite score matches formula; Healthy band confirmed unreachable
- [ ] 5.9.2 Cross-site duplication detected
- [ ] 5.9.3 Rescan updates, doesn't duplicate, Document rows
- [ ] 5.9.4 Upstream-deleted document marked Removed, not deleted

### Historical snapshots (5.10)
- [ ] 5.10.1 Snapshot written only for Completed scans

### Trends (5.11)
- [ ] 5.11.1 Trend points correct and chart-ready; invalid `days` → 400
- [ ] 5.11.2 Scan comparison correct; first-ever scan returns null-friendly empty shape

### Governance (5.12)
- [ ] 5.12.1 Track a detected issue; untracked type/unscored doc → 404; duplicate track → 409
- [ ] 5.12.2 Status transitions strictly one-step; skip-ahead → 409
- [ ] 5.12.3 Assignment requires Active, same-org user
- [ ] 5.12.4 Resolving doesn't require the HealthIssue to still be detected

### Ownership (5.13)
- [ ] 5.13.1 Manual assignment survives a rescan
- [ ] 5.13.2 Owner removal behaves as expected against Graph-sourced vs. manual rows

### Audit history (5.14)
- [ ] 5.14.1 Every governance action produces exactly one activity row; no mutation path exists
- [ ] 5.14.2 Pagination correct on both activity endpoints

### Analytics (5.15)
- [ ] 5.15.1 Filters combine as AND; invalid values → 400
- [ ] 5.15.2 Large-tenant latency measured and recorded

### Permissions (5.16)
- [ ] 5.16.1 Full role × endpoint matrix verified, including via the actual web UI

### Multi-tenant isolation (5.17)
- [ ] 5.17.1 Cross-org `:id` access rejected on every controller spot-checked
- [ ] 5.17.2 Crafted cross-org IDs in body/query never leak or write data

### Error handling (5.18)
- [ ] 5.18.1 Malformed input → 400 with clear messages across all query-parsing endpoints
- [ ] 5.18.2 Not-found → 404 everywhere
- [ ] 5.18.3 No secret ever leaks in a response or log, even on a Graph auth failure

### Recovery scenarios (5.19)
- [ ] 5.19.1 Worker-crash-mid-scan reproduced; confirmed permanently wedged until manual fix
- [ ] 5.19.2 Redis down → degraded readiness, reads still work, mutations fail cleanly
- [ ] 5.19.3 Postgres down → degraded readiness, clean 5xx everywhere, no leaked stack traces
- [ ] 5.19.4 One bad site's failure doesn't abort the rest of a scan

---

## 7. Features that should be disabled or hidden until validated

None of these require new code to "disable" — they're either already inaccessible via
the web UI (so the disabling has effectively already happened by omission) or are
low-risk enough to leave reachable with a documented caveat. Framed as a rollout
recommendation, not an implementation task:

- **Scheduled scans**: fully implemented and covered by tests, but has the *least*
  production runtime exposure of any feature in this build (only reachable via a
  15-minute BullMQ heartbeat, never directly exercised by a person). Recommend running
  it in a real, longer-duration LAT window (several days, multiple real ticks) before
  trusting it in production — a single manual `nextRunAt` backdating test (5.7.2) is
  necessary but not sufficient confidence for a feature that's supposed to run
  unattended for months.
- **Governance analytics** (`GET .../governance/analytics`) on tenants above a few
  hundred issues: not broken, but its in-memory aggregation is unvalidated at real
  scale (§5.15.2) — recommend flagging it internally as "validate response time before
  enabling for any customer with a large governance backlog," rather than gating it in
  code.
- **Site discovery/approval and second-user approval workflows**: not really
  "features to hide" so much as **features with no operable UI at all** (§1.1, §1.2).
  They are already effectively hidden from any real end user by omission. The
  recommendation is the inverse of "disable": these need a UI built (out of scope for
  this hardening/testing phase) before any customer beyond a single-admin,
  API-comfortable pilot could use the product end-to-end without direct database or
  API access.
- **Scan retry on worker crash**: given §1.4/§5.19.1, if this product goes to production
  before that gap is addressed, whoever operates it needs a runbook entry (already
  partially covered in `docs/architecture/operations.md`) for manually recovering a
  wedged `ScanJob` — this isn't something to hide, but it should not be presented to a
  customer as "self-healing" until it actually is.
