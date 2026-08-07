# Demo data seed

Populates the **existing, already-connected** demo organization with a
realistic enterprise dataset — documents in varied health states,
governance issues across every status, a real activity trail, real
notifications, and audit history — so the product demonstrates its actual
value instead of an empty/sparse tenant.

This is a manual, operator-run tool. It is never imported by `apps/api`,
`apps/worker`, or `apps/web` — nothing in the deployed application knows
this directory exists.

## Running it

```bash
# from apps/api
pnpm demo:seed --organization-id=<id>
# or
DEMO_ORGANIZATION_ID=<id> pnpm demo:seed
```

Find the organization id via the app itself (it's in the URL/API responses
once signed in), or ask whoever owns the demo tenant. The script refuses to
run without one, and refuses to run against an id that doesn't resolve to
a real `Organization` — it will never guess which org to seed into.

It also requires the target organization to already have a connected
Microsoft tenant and at least one Active Admin user (i.e., real onboarding
must already be complete) — this tool only adds *demo content* on top of a
real, already-onboarded organization, never the onboarding itself.

**If `pnpm demo:seed` fails with a Ruby `dotenv` error** (`invalid option:
-e`), your shell's `PATH` has a Ruby gem's `dotenv` binary ahead of this
project's local one. Either fix your `PATH` ordering, or run directly:
`pnpm exec dotenv -e ../../.env -- ts-node -P tsconfig.json src/scripts/demo-seed/seed.ts --organization-id=<id>`.

## What it creates

- **1 SharePoint site** ("Corporate Knowledge Base") — deliberately a
  *separate*, dedicated site, not mixed into the org's real one(s). See
  "Why a dedicated site" below for why this matters.
- **30 documents** across every real scoring criterion
  (`packages/scoring`) — healthy, missing owner, no review date, stale
  (Freshness), old-since-creation (Age), exact-match duplicates, and
  placeholder-named (Metadata — see the note on "Broken reference" below).
  Every score/issue is computed by the **real** `calculateScore()`
  function against realistic metadata, never hand-picked.
- **5 historical, completed scan jobs**, spread over the last 28 days —
  drives the dashboard's "last scan" timestamp, the Scans page's recent
  history, and gives `GovernanceAnalyticsService`'s default 30-day window
  real data to show.
- **11 governance issues** spanning Open, InProgress, and Resolved, with a
  realistic multi-week creation/resolution spread — this is what makes
  Governance Analytics' six charts (trend, by-type, status distribution,
  resolution-time distribution, issue aging, recent activity) all show
  something real instead of "not enough data yet."
- **A full `GovernanceActivity` trail** per historical issue (created →
  assigned → status changed → resolved), plus one issue created *live*
  through the real `GovernanceIssuesService`/`GovernanceActivityService`
  call path (self-assigned to the Admin) so the demo has a genuine,
  current-moment activity and notification to show, not just backdated
  history.
- **Real notifications**: an unread `IssueAssigned` (from the live
  self-assignment above), and a real `ResolutionSuggested` produced
  through the same `upsertByDedupeKey` mechanism
  `NotificationReconciliationService` itself uses — not a fabricated row.
- **2 demo users**: "Jordan Lee" (Active, a realistic assignee for several
  issues) and "Morgan Taylor" (PendingApproval — approve them live on the
  Users page during the demo for a real, interactive `user.approved` audit
  entry).
- **Audit log entries** for the demo site's approval and each historical
  scan trigger, through the real `AuditLogService`.

## Design choices worth knowing before you run this

**Why a dedicated site, not the org's real one(s).** Any real scan that
runs against this organization — including one triggered manually by
someone actively using the app, which is common in a shared dev
environment — re-scores every Active document org-wide, and reconciles
away (marks `Removed`) any document a real Graph enumeration doesn't
report. Putting demo documents on the org's *real* site would mean a real
scan silently deletes the whole demo dataset. Putting them on a dedicated
site with a deliberately fake `graphSiteId` means a real scan's
enumeration attempt for that site fails outright (never reaches
reconciliation), which protects the demo documents from ever being marked
Removed — at the cost of one harmless failed-site line in that scan's own
error summary. **Still recommended**, belt-and-suspenders: check the
org's scan schedule isn't about to fire between seeding and presenting.

**"Broken reference" isn't a real criterion in this product.** The
request that shaped this script listed five issue types, one of which —
"broken reference" — has no equivalent among the 6 real
`ScoringCriterion` values (`Freshness`, `Ownership`, `ReviewStatus`,
`Metadata`, `Duplication`, `Age`). `Metadata` (placeholder-looking file
names) is the closest real signal and was substituted deliberately, not
silently reinterpreted — see `document-plan.ts`'s own comment.

**Historical `GovernanceActivity` rows bypass the service layer on
purpose.** `GovernanceActivityService.record()` always stamps `createdAt`
as "now," and `GovernanceActivityRepository` has no update method at all
— it's immutable by design (ADR-0016). Backdating is only possible at the
moment of creation, so historical issues are created directly through
`createTenantContext`'s repository layer (still fully tenant-scoped, never
raw Prisma) rather than the service. Exactly one issue in the plan is
created through the real, live service call path instead, so the demo
still has a genuine current-moment activity/notification to show.

**A caught-and-fixed bug worth knowing about**: the first version of the
`ResolutionSuggested` simulation only faked `hasReviewDate: true` as a
scoring *input*, without updating the underlying `Document.nextReviewDueAt`
column. A real scan re-scoring that document from its actual stored data
found the review date still missing, re-detected the issue, and silently
undid the simulated fix — confirmed live, against this exact dev tenant,
while this script was being developed. Fixed by making the simulation
genuinely persist the underlying field it claims to have changed. If you
ever extend `simulateResolutionSuggested` to a criterion other than
`ReviewStatus`, you must make its fix similarly real, not just a scoring
argument — the function deliberately throws if you try to use it for a
different criterion without doing this.

**A known, unfixed limitation of this org's real data**: the real Admin
user's `email` is an empty string (Entra optional-claims configuration
gap, not a code defect — already flagged separately). This is why the
self-owner-assignment demo step logs a warning and skips instead of
silently doing nothing — `resolveOwnerUserId` correctly treats an empty
string the same as "no email." The primary live-notification demo moment
(self-assigning a governance issue) is unaffected, since that path
notifies by user id, never by email.

## Idempotency

Safe to run repeatedly. Every model this script creates directly is
checked for existence first (by `graphSiteId`, `graphItemId`,
`entraObjectId`, a deterministic scan job id, or `GovernanceIssue`'s own
`(documentId, issueType)` uniqueness) before creating anything. Documents
found `Removed` (e.g., by an intervening real scan somehow reaching them)
are revived back to `Active` rather than left broken. Re-running reports
what already existed and creates nothing new on top of it.

## Resetting

```bash
pnpm demo:reset --organization-id=<id>              # dry run — reports what would be deleted
pnpm demo:reset --organization-id=<id> --confirm     # actually deletes it
```

Deletes the demo site (which cascades to every document, health score,
health issue, governance issue, and governance activity beneath it — all
`onDelete: Cascade` in the schema), the historical scan jobs, and the two
demo users. Does **not** delete the `AuditLog` entries this script
created, or any `Notification` row that referenced a since-removed
document/issue (its reference is nulled out, not deleted) — neither
`AuditLogRepository` nor `NotificationRepository` exposes a delete method,
by design, and this tool doesn't route around that. See `reset.ts`'s own
module comment for the full reasoning.
