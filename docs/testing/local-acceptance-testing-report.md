# Local Acceptance Testing — Report

Date: 2026-07-15
Scope: full execution of `docs/testing/local-acceptance-testing.md` against a real Microsoft 365
tenant, run locally (Postgres + Redis via `docker-compose.yml`, `apps/api`/`apps/worker`/`apps/web`
via `pnpm dev`). Every result below is evidence-based: cross-checked directly against the dev
database and/or live API responses, not inferred from UI appearance alone.

**Overall result: Conditional pass — not yet ready for net-new-customer sign-off.**
The core detection/governance pipeline (scoring, scanning, governance workflow, permissions,
tenant isolation) is solid and thoroughly verified — 17 of 19 sections passed cleanly. Two things
block full production sign-off: a critical onboarding gap (no working entry point for a brand-new
customer) and one acceptance-criteria failure (Redis-unavailable scan trigger doesn't fail
gracefully). For an already-provisioned, single-tenant deployment, the system held up well under
rigorous testing with zero data-integrity issues found anywhere.

---

## 1. Section results

| Section | Result | Notes |
|---|---|---|
| §5.1 Authentication | PASS (partial) | First-sign-in bootstrap, invalid/malformed token rejection, second-user PendingApproval flow all confirmed. Personal-MSA-account and genuinely-expired-signed-token rejection not testable in this session (needs a real personal Microsoft account / waiting out a real token's lifetime). |
| §5.2 Organization onboarding (security) | PASS | Unrecognized-tenant rejection confirmed live + via automated regression test; `provisionOrganizationFromConsent` confirmed reachable only from `POST /auth/consent-callback` (single call site); full guard-chain audit across every controller. |
| §5.3 Microsoft tenant connection | PASS | `Consented` status confirmed post-onboarding; `Revoked` tenant correctly excluded from scan-trigger resolution (`404`), test state reverted cleanly. |
| §5.4 SharePoint discovery | PASS | 5 real sites discovered, no duplicates, correct org ownership, correct Graph Site ID format. Re-discovery confirmed idempotent (same row IDs, same `createdAt`, approval state fully preserved). |
| §5.5 Site approval | PASS (1 gap found + fixed) | Approve/revoke confirmed both directions; Member correctly blocked (hidden UI + server `403`); a missing "Re-approve" UI path for `Removed` sites was found and fixed during this QA cycle (see §3). |
| §5.6 Manual scans | PASS | Real scan completed (6 documents), correct `ScanJob` fields; concurrency guard confirmed via existing automated test; non-Admin correctly blocked. |
| §5.7 Scheduled scans | PASS | Real scheduler tick fired twice (once transiently failed — see Finding, once clean); duplicate-schedule `409` confirmed; disabling confirmed to stop future ticks without deleting the row. |
| §5.8 Scan progress | PASS (partial) | Final-state progress fields (`totalSites`/`sitesCompleted`/`currentSiteName`) confirmed correct on every scan. Mid-flight transition not observable — this dev tenant's scans complete in 2-4 seconds, too fast to catch an intermediate state; would need the LAT doc's "Medium tenant" profile (3+ sites, tens of seconds). |
| §5.9 Health scoring | PASS (1 finding) | Every scanned document has a score; composite formula hand-verified exact match to `SCORING_WEIGHTS`/`HEALTH_BANDS`; org-level aggregation matches API-to-DB exactly; rescan/deletion behavior confirmed correct at row-identity level. One finding on scoring-vs-scan-status coupling (see §2). |
| §5.10 Historical snapshots | PASS | Exact 1:1 correspondence between `Completed` scans and `HealthSnapshot` rows; correctly absent for the one `Failed` scan. |
| §5.11 Trends | PASS (1 finding) | `GET .../health-trends` response byte-for-byte matches underlying `HealthSnapshot` rows. Scan comparison aggregate deltas exact; one finding on issue-diff labeling (see §2). |
| §5.12 Governance | PASS | Full issue lifecycle (create → assign → `Open→InProgress→Resolved` → reopen) verified with a complete, correct `GovernanceActivity` audit trail; illegal transition correctly rejected (`409`); tenant isolation confirmed. |
| §5.13 Ownership | PASS | Manual assignment confirmed to survive a rescan at the row-identity level (same row untouched, Graph-derived row recreated with a new ID); removal correctly scoped to manual-only rows (`409` on attempting to remove a Graph-sourced row); audit trail persists after the underlying row is deleted; tenant isolation confirmed. |
| §5.14 Audit history | PASS | Every real action produced exactly the right `GovernanceActivity` row(s), including zero phantom rows for two rejected (`409`) requests; pagination confirmed correct across 3 pages with zero duplicates/gaps; tenant isolation confirmed. |
| §5.15 Analytics | PASS (1 sub-test not testable) | Every bucketed metric matched hand-computed predictions exactly; AND-logic filter combination confirmed precisely; invalid input returns clean `400`s; tenant isolation confirmed. Large-tenant performance not testable — this dev tenant (1 issue, 8 activity rows) is far too small to evaluate the documented in-memory-aggregation scaling risk. |
| §5.16 Permissions | PASS | Full role × endpoint matrix built from direct evidence; every Admin-only action confirmed blocked for Member both in the UI (hidden) and at the API layer (`403`). `GovernanceManager` row not testable — no user with that role was ever provisioned in this dev tenant. |
| §5.17 Multi-tenant isolation | PASS | All 10 requested data-access surfaces (documents, health scores, health trends, governance issues, activities, SharePoint sites, scan jobs, analytics, ownership, user management) confirmed to reject a mismatched organization ID with `403`. |
| §5.18 Error handling | PASS | Malformed input returns structured `400`s across every tested surface; well-formed-but-nonexistent resources return clean `404`s; no secret/stack-trace leakage observed across the entire session (~50+ requests), including a real Graph-failure `errorSummary`. |
| §5.19 Recovery scenarios | 1 FAIL, rest PASS/not-testable/audited | See §2 for the FAIL. Postgres-unavailable handling fully passed. Worker-crash-mid-scan recovery and BullMQ job-retry behavior were reviewed via code audit only, not live-triggered, per an explicit scoping decision partway through this session. Partial multi-site scan failure not testable (only 1 approved site in this dev tenant). |

## 2. Findings, by severity

### Critical

**F1 — No working onboarding entry point for a brand-new organization.**
`apps/web` never calls `POST /auth/consent-callback` anywhere in its source (confirmed by
exhaustive grep) — the only endpoint that can create a new `Organization`/`MicrosoftTenant`/Admin
`User` (ADR-0012 §1/§3). The endpoint itself works correctly; nothing in the product drives a user
to it. Discovered during this LAT cycle, not previously documented — the LAT plan's own §5.1.1
incorrectly implies that signing in alone bootstraps the organization, which the actual code does
not do. **Blocks onboarding any genuinely new customer through the product as it stands.**
Unblocked for this LAT cycle only via a documented, temporary, non-product dev workaround
(manually extracting a cached MSAL ID token and POSTing it directly to the existing endpoint).

### High

**F2 — Redis-unavailable scan trigger hangs instead of failing gracefully (§5.19.2 FAIL).**
Violates a named LAT acceptance criterion ("attempting to trigger a scan should fail gracefully,
not hang indefinitely"). Root cause confirmed in code: `apps/api/src/app.module.ts:23-29`
registers BullMQ with no `maxRetriesPerRequest`/`connectTimeout` override, so it runs on
ioredis's default retry ceiling (bounded, but slow enough to feel indefinite). Compounding cause
confirmed on the frontend: `apps/web/src/lib/api/client.ts` has no request timeout or
`AbortController` anywhere, so the UI waits for however long the backend takes with no fallback
to a degraded/error state — this produced the paired dashboard "stuck loading" symptom observed
live during testing.

### Medium

**F3 — `HealthScore` generation is not gated on scan-collection success.**
`document-collector.processor.ts:113` calls `scoreTenantDocuments` unconditionally, before the
overall `ScanJob.status` (`Completed`/`Failed`) is determined at line 115. A `ScanJob` that
ultimately fails (e.g., every site failed to collect) still re-scores every existing Active
document from already-stored (unchanged) data and promotes the result to
`Document.currentHealthScoreId` — reproduced live: a document's "current" score traced back to a
`ScanJob` whose own status was `Failed`. The computed values themselves were mathematically
correct; only the provenance/status coupling is the issue. `HealthSnapshot` is correctly gated
(`if (status === 'Completed')`); `HealthScore` promotion is not. Confirmed via QA discussion:
does not invalidate §5.9.3's own acceptance criteria.

**F4 — Scan comparison mislabels a deleted document's issue as "resolved."**
`scans.service.ts`'s `issuesForScan` scopes purely by `scanJobId`, with no document-status
awareness. A document deleted from SharePoint (and correctly excluded from re-scoring) has no
`HealthScore` row in the next scan, so its previous issue's `(documentId, criterion)` key
disappears from the diff by the same mechanism a genuine fix would — landing in `resolvedIssues`
indistinguishable from an actually-fixed issue. Functionally correct per the documented diff rule;
semantically misleading to a human/UI reader.

**F5 — User approval has no audit trail.**
Unlike every other privileged action in this system (`MicrosoftTenant.consentGrantedByUserId`/
`consentGrantedAt`, `SharePointSite.approvedByUserId`/`approvedAt`, `GovernanceActivity` for
governance/ownership actions), approving or rejecting a `PendingApproval` user leaves no record of
who acted or when.

### Low

**F6 — Worker error logging drops the underlying stack trace.**
`document-collector.processor.ts:103` logs only `error.message` via `this.logger.error(...)`, not
the full `error` object — confirmed directly responsible for why the real `"fetch failed"`
incident during §5.7.2 couldn't be root-caused beyond "a network-layer failure" from logs alone.

**F7 — `User.email` persists as an empty string** when the Entra ID token carries no `email`
claim (observed on the real bootstrapped Admin user). An Entra App Registration optional-claims
configuration issue, not a code defect.

**F8 — `AssigneeChanged` governance activity type was never exercised** in this LAT cycle (only a
single, first-time assignment was tested, never a *re*-assignment). Test-coverage gap, not a
product issue.

## 3. Items fixed during this QA cycle

**Missing "Re-approve" action for `Removed` SharePoint sites.** The backend (`approveSite` in
`sharepoint-sites.service.ts`) already supported transitioning a `Removed` site back to
`Approved` unconditionally; the frontend (`sharepoint-site-list.tsx`) simply never rendered a
control for that status. Added one conditional button reusing the existing `approve`
handler/endpoint — no backend, schema, or API contract change. One new test case added
(`sharepoint-site-list.test.tsx`); full `@sph/web` suite re-run clean (30/30 suites, 127/127
tests, lint/typecheck/build all green). Verified end-to-end against the real dev tenant: DB
confirmed `status: Removed → Approved` with a fresh `approvedAt` timestamp.

## 4. Deferred items (explicitly out of scope this cycle)

- Building the real "Connect Microsoft 365" onboarding flow (F1)
- Redis command timeout (backend) + fetch timeout/`AbortController` (frontend) (F2)
- `HealthScore`-on-failed-scan gating fix (F3)
- Scan-comparison "resolved" labeling fix (F4)
- User-approval audit trail (F5)
- Worker error-logging stack-trace capture (F6)
- Live worker-crash-mid-scan reproduction (accepted as code-audited only, by explicit scoping
  choice partway through this LAT cycle)

## 5. Not-testable items and why

| Item | Why |
|---|---|
| §5.1.2 personal-MSA-account / genuinely-expired-signed-token rejection | Requires a real personal Microsoft account sign-in, or waiting out a real ID token's natural expiry — neither available in this session |
| §5.9.2 cross-site duplicate detection | Only 1 SharePoint site is `Approved` in this dev tenant; the rule is tenant-wide but needs 2+ approved sites with a matching `(name, sizeBytes)` pair to exercise |
| §5.8.1 mid-flight scan progress (`currentSiteName` populated during a `Running` scan) | Every real scan in this dev tenant completed in 2-4 seconds (1 site, 6 documents) — too fast to observe an intermediate state; needs the LAT doc's "Medium tenant" profile (3+ sites, tens of seconds) |
| §5.15.5 large-tenant analytics performance | This dev tenant has 1 `GovernanceIssue` and 8 `GovernanceActivity` rows — nowhere near the scale (hundreds to thousands) needed to evaluate the documented in-memory-aggregation risk |
| §5.16 `GovernanceManager` role matrix row | No user with that role was ever provisioned in this dev tenant (only `Admin` and `Member` exist) |
| §5.19 partial multi-site scan failure ("one bad site doesn't abort the rest") | Only 1 approved site in this dev tenant — nothing else to remain unaffected |

## 6. Final recommendation

**Not ready for full production sign-off as-is.** Two items gate that specifically:

1. **F1 (onboarding)** must be built before any real new customer can be onboarded through the
   product at all — this is the single highest-priority next-phase item.
2. **F2 (Redis graceful-degradation FAIL)** should be fixed before trusting this system in any
   environment where a transient Redis blip is a real operational possibility (i.e., production).

For an already-provisioned, single-tenant deployment (i.e., using the documented dev workaround to
provision), the system is in genuinely good shape — scoring, scanning, governance, permissions,
and tenant isolation all held up under rigorous, evidence-based testing (direct DB verification,
not just API-response trust) with zero data-integrity issues found anywhere across 19 test
sections and ~50+ live requests.

---

# Remediation Plan

## Priority 1 — Phase 6 blockers (must fix before customer onboarding)

1. **Build the "Connect Microsoft 365" onboarding entry point (F1).** Needs its own planning pass:
   at minimum, a web UI flow that obtains a valid ID token (the app already does this via MSAL for
   every other sign-in) and calls the existing, already-correct `POST /auth/consent-callback` with
   it plus an organization name — no backend change required, this is purely closing the missing
   frontend/flow gap. The real design question for Phase 6 planning: whether this reuses the
   existing regular sign-in's ID token directly (simplest, matches how the dev workaround already
   proved the backend behaves) or requires a separate, more ceremonial "admin consent" entry
   point distinguishable from a regular sign-in.

## Priority 2 — Production hardening

2. **Redis graceful-degradation fix (F2).** Two independent, complementary changes:
   - Backend: set an explicit `maxRetriesPerRequest`/`connectTimeout` on the BullMQ Redis
     connection (`apps/api/src/app.module.ts`) so a scan-trigger request fails fast with a clear
     `5xx` instead of waiting out ioredis's default retry ceiling.
   - Frontend: add a request timeout/`AbortController` to `apps/web/src/lib/api/client.ts` so the
     UI falls back to a visible error/degraded state rather than indefinite loading, independent of
     whatever the backend's own timeout ends up being.

## Priority 3 — Future improvements (not blocking, lower urgency)

3. **F3 — Gate `HealthScore` promotion on the scan's own success**, not just run scoring
   unconditionally regardless of collection outcome — likely needs the same `status`-determination
   logic (currently computed *after* scoring runs) to move earlier, or for scoring to accept the
   partial-failure state as an input.
4. **F4 — Distinguish "resolved" from "document deleted"** in scan comparison's issue diff — either
   exclude deleted documents from `resolvedIssues` entirely, or tag them with a distinct reason
   (e.g. `resolvedReason: 'documentRemoved' | 'fixed'`).
5. **F5 — Add an audit trail for user approval/rejection**, matching the existing
   `<action>ByUserId`/`<action>At` pattern already used everywhere else in this schema
   (`MicrosoftTenant.consentGrantedByUserId`, `SharePointSite.approvedByUserId`).
6. **F6 — Capture the full error/stack in worker site-collection failure logs**, not just the
   message string, to make rare network-failure root-causing tractable from logs alone.
7. **F7 — Investigate the Entra App Registration's optional-claims config** so ID tokens reliably
   carry an `email` claim (low priority — email is already documented as display-only, never used
   for identity/authorization per ADR-0011).
8. **F8 — Add a test exercising `AssigneeChanged`** (re-assigning an already-assigned issue) for
   full governance-activity-type coverage.
9. Live-verify worker-crash-mid-scan recovery and BullMQ job-retry behavior in a later, dedicated
   session (accepted as code-audited-only this cycle, not because it's low-risk, but because it
   wasn't prioritized for live disruption this round).
