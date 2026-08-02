# Local Acceptance Testing — Report

Date: 2026-07-15
Scope: full execution of `docs/testing/local-acceptance-testing.md` against a real Microsoft 365
tenant, run locally (Postgres + Redis via `docker-compose.yml`, `apps/api`/`apps/worker`/`apps/web`
via `pnpm dev`). Every result below is evidence-based: cross-checked directly against the dev
database and/or live API responses, not inferred from UI appearance alone.

**Overall result: Pass, no remaining sign-off blockers.**
The core detection/governance pipeline (scoring, scanning, governance workflow, permissions,
tenant isolation) is solid and thoroughly verified — 17 of 19 sections passed cleanly, and both
items that originally blocked sign-off (F1, F2) are now resolved. Two new, lower-severity findings
(F9, F10) surfaced during F2's fix verification and are tracked below, neither blocking. For an
already-provisioned, single-tenant deployment, the system held up well under rigorous testing with
zero data-integrity issues found anywhere.

**Update (2026-07-15, Phase 6): F1 resolved.** See F1's entry in §2 and the updated Priority 1
remediation item.

**Update (2026-07-15/16, Phase 7): F2 resolved**, after two correction rounds during manual
verification — see F2's entry in §2 for the full story, and F9/F10 for two new findings the
verification process itself surfaced.

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

**F1 — No working onboarding entry point for a brand-new organization. — RESOLVED (Phase 6, 2026-07-15)**
`apps/web` never called `POST /auth/consent-callback` anywhere in its source (confirmed by
exhaustive grep) — the only endpoint that can create a new `Organization`/`MicrosoftTenant`/Admin
`User` (ADR-0012 §1/§3). The endpoint itself always worked correctly; nothing in the product drove
a user to it. Discovered during this LAT cycle, not previously documented — the LAT plan's own
§5.1.1 incorrectly implied that signing in alone bootstraps the organization, which the code never
did. **Blocked onboarding any genuinely new customer through the product as it stood.** Unblocked
for this LAT cycle only via a documented, temporary, non-product dev workaround (manually
extracting a cached MSAL ID token and POSTing it directly to the existing endpoint).

**Resolution**: implemented as Priority 1 of the remediation plan below — a frontend-only
"Connect Microsoft 365" flow, no backend/schema change. Real Microsoft tenant-wide admin consent
(`Files.Read.All`/`Sites.Read.All`) is now a genuine, Microsoft-verified UI gating step before
`/auth/consent-callback` is ever called. Implementation reference:
- `apps/web/src/app/connect/page.tsx` — entry page (organization name input, navigates to
  Microsoft's admin-consent endpoint).
- `apps/web/src/app/connect/admin-consent-callback/page.tsx` — receives Microsoft's admin-consent
  result, hands off to the existing MSAL sign-in flow unchanged.
- `apps/web/src/app/connect/finishing/page.tsx` — the bootstrap orchestrator; calls the existing
  `/auth/consent-callback` and routes on all four `ConsentResolution.kind` values exhaustively.
- `apps/web/src/app/page.tsx` — one additive check (a sessionStorage marker) routing a
  connect-flow user to `/connect/finishing` instead of `/dashboard`; verified with regression tests
  proving zero behavior change for every existing/returning user.
- `docs/decisions/0012-organization-onboarding-and-user-provisioning.md`'s 2026-07-15 amendment —
  documents this flow and a deliberately **deferred**, non-blocking gap: the backend still cannot
  cryptographically verify real admin consent happened (vs. someone POSTing a self-obtained ID
  token directly) — closing that fully needs a server-side Graph app-role-assignment check, named
  as future work, not part of this resolution.
- Full verification: `pnpm exec turbo run lint typecheck test build --filter=@sph/web` green
  throughout implementation (34 test suites / 161 tests at completion, up from 30/127 at the start
  of this LAT cycle).

### High

**F2 — Redis-unavailable scan trigger hangs instead of failing gracefully (§5.19.2 FAIL). — RESOLVED (Phase 7 + corrective round, 2026-07-16)**
Violated a named LAT acceptance criterion ("attempting to trigger a scan should fail gracefully,
not hang indefinitely"). Root cause: `apps/api/src/app.module.ts`'s BullMQ registration had no
`maxRetriesPerRequest`/`connectTimeout` override, so it ran on ioredis's default retry ceiling
(bounded, but slow enough to feel indefinite — the frontend compounded this further, since
`apps/web/src/lib/api/client.ts` had no request timeout at all).

**Resolution, in two rounds** (both confirmed against a real stopped/restarted Redis container, not
assumed):
- **Round 1**: added explicit `maxRetriesPerRequest: 1`/`connectTimeout: 5000` to the BullMQ
  connection (`apps/api/src/app.module.ts`'s `bullConnectionOptions()`), plus a default 20s request
  timeout via `AbortController` on `apps/web/src/lib/api/client.ts`'s `apiRequest`. This correctly
  bounded `queue.add()` (confirmed live: `500` in 45ms during an outage, down from an indefinite
  hang) — but manual verification found `GET /health/ready` still took **21.1 seconds**. Root
  cause: `health.service.ts`'s `checkRedisConnection()` calls `this.scanQueue.client`, which
  resolves via BullMQ's `waitUntilReady()` — that function waits for ioredis's `'ready'`/`'end'`
  event and never sends a command, so it isn't bounded by `maxRetriesPerRequest` at all (confirmed
  by reading BullMQ's `redis-connection.js` source directly).
- **Round 1 correction attempt**: added an explicit `retryStrategy` that gave up (`return null`)
  after 2 retries, so the client would actually reach `'end'` and unblock `waitUntilReady()`. This
  fixed the 21s hang — but manual verification of Redis *recovery* found a real regression: once
  `retryStrategy` returns `null`, ioredis stops attempting automatic reconnection **permanently**,
  not just for the current failed attempt. Confirmed live: after restarting Redis, `/health/ready`
  kept reporting `redis: 'error'` and scan triggers kept failing with orphaned jobs (see F9) —
  the connection never self-healed without restarting `apps/api`.
- **Round 2 (final)**: reverted `retryStrategy` to ioredis's own default (infinite retry, capped
  backoff), preserving automatic self-healing. Fixed the `/health/ready` hang at its actual source
  instead — an explicit `Promise.race`-based timeout (`withTimeout`, 3000ms) wrapping just the
  `this.scanQueue.client` await in `health.service.ts`, leaving the connection's own reconnection
  behavior untouched. Confirmed live: Redis down → `/health/ready` in ~7.3s (down from 21.1s — see
  F10 on why this is higher than the 3000ms target, not yet fully explained) and scan trigger in
  45ms; Redis restored → scan trigger succeeded **without restarting `apps/api`**, confirming
  self-healing works.

- **Round 3 (F2 corrective fix, 2026-07-16 — closes this out)**: Round 2's `45ms` scan-trigger
  measurement turned out not to be representative. Re-testing found genuine variance of **15s and
  38s** on two consecutive real attempts against a stopped Redis. Root cause, confirmed by reading
  `ioredis@5.10.1`'s actual source (`event_handler.js:170-208`): `maxRetriesPerRequest` is **not** a
  per-command retry bound — it's a periodic, connection-wide queue flush tied to a single shared
  `retryAttempts` counter (reset only on a successful `'ready'` event), which fires only when that
  counter crosses a multiple of `(maxRetriesPerRequest + 1)`. A command's actual wait time depends
  entirely on when it happens to be issued relative to the connection's own ongoing, independent
  background retry cycle — anywhere from near-instant to several full reconnect cycles away. Also
  confirmed separately: BullMQ's `JobsOptions` has no job-level timeout field at all — an
  application-level timeout was the only available lever. Fix: extracted `health.service.ts`'s
  `withTimeout` into a shared `apps/api/src/common/with-timeout.ts`, and wrapped
  `scans.service.ts`'s `queue.add()` call with a dedicated `10_000ms` timeout (kept distinct from
  `health.service.ts`'s `3000ms`, since the two operations have different acceptable budgets) —
  entirely inside F9's existing try/catch, which was left completely unmodified (F9 doesn't
  distinguish *why* enqueue failed, so a timeout is handled identically to a raw ioredis error).
  ioredis's connection config (`maxRetriesPerRequest`/`connectTimeout`/`retryStrategy`) was
  deliberately left unchanged from Round 2 — self-healing no longer depends on it being tuned
  correctly, since the application-level timeout now provides the real guarantee.

  **Confirmed live, 5 consecutive attempts against a real stopped Redis**: every single one landed
  at **10.00-10.03s** (down from the prior 45ms-38s range — now genuinely deterministic, not just
  bounded), each correctly producing `ScanJob.status: 'Failed'` with
  `errorSummary: "Failed to enqueue scan job: Redis enqueue timed out"`, zero orphaned `Queued`/
  `Running` rows. Redis restored → scan succeeded in `67ms` **without restarting `apps/api`**,
  reconfirming self-healing is fully intact. One accepted, documented, narrow risk: `Promise.race`
  doesn't cancel the losing `queue.add()` promise — confirmed via `document-collector.processor.ts`
  that the worker has no status guard before transitioning a job to `Running`, so a very-late
  successful enqueue could theoretically still run a scan the API already reported as failed.
  Flagged as a candidate for future hardening, not fixed (would require a worker-side change, out
  of this fix's scope).

Implementation reference: `apps/api/src/app.module.ts` (`bullConnectionOptions`),
`apps/api/src/common/with-timeout.ts` (shared `withTimeout` utility), `apps/api/src/health/health.service.ts`,
`apps/api/src/scans/scans.service.ts` (`SCAN_ENQUEUE_TIMEOUT_MS`), `apps/web/src/lib/api/client.ts`
(`apiRequest`'s `timeoutMs`). Tests: `apps/api/src/app.module.spec.ts`,
`apps/api/src/common/with-timeout.spec.ts`, `apps/api/src/health/health.service.spec.ts`,
`apps/api/src/scans/scans.service.spec.ts`, `apps/web/src/lib/api/__tests__/client.test.ts`.
`apps/worker` deliberately untouched throughout (its `Worker`-hosting connection has a different,
stricter BullMQ constraint — see the code comment in `app.module.ts`).

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

**F9 — A `queue.add()` failure leaves a permanently orphaned `Queued` `ScanJob` row. — RESOLVED (2026-07-16)**
Discovered while verifying F2's fix: `ScansService.triggerScanForOrganization` creates the
`ScanJob` row in Postgres *before* calling `queue.add()`. If `queue.add()` then fails (e.g. a Redis
outage — now correctly fast-failing instead of hanging, thanks to F2's fix, which makes this far
easier to trigger in practice), the request returns `500`, but the `ScanJob` row is already
committed as `Queued` and nothing ever transitions it out of that state — no worker will ever pick
it up, since it was never actually enqueued. Every subsequent scan-trigger attempt for that
Microsoft tenant then hits the `409` concurrency guard indefinitely. `StaleScanRecoveryService`
does not help — it only recovers jobs stuck at `Running` (via a 2-hour threshold), never `Queued`.
Reproduced **four times** during F2's manual verification (both via direct API calls and via the
dashboard UI), each requiring a manual DB update to clear before testing could continue. Distinct
from the already-known worker-crash-mid-scan gap (`docs/architecture/operations.md`) — this one
requires no worker crash at all, just a producer-side enqueue failure.

**Resolution**: `ScansService.triggerScan` (`apps/api/src/scans/scans.service.ts`) wraps
`queue.add()` in a try/catch. On any failure, a compensating write (not a cross-system transaction —
Postgres and Redis are separate systems) marks the same `ScanJob` row `Failed` with
`completedAt`/`errorSummary` set, reusing the exact shape `recoverStaleScanJobs`
(`packages/database/src/scan-recovery.ts`) already established for the same class of problem, then
re-throws the original error so the caller-visible `500` behavior is unchanged. No schema change, no
new status value (`Failed` already existed). Confirmed live, repeatedly, during F2's corrective round
(5 consecutive Redis-down attempts): every failed enqueue correctly produced `status: 'Failed'`,
a legible `errorSummary`, and zero orphaned `Queued`/`Running` rows — a subsequent scan trigger was
never blocked. Tests: `apps/api/src/scans/scans.service.spec.ts`.

**F10 — `/health/ready`'s Redis check takes ~7.3s during an outage, not the ~3s its own explicit
timeout should bound it to.** `health.service.ts`'s new `withTimeout(this.scanQueue.client, 3000)`
(added as part of F2's fix) should reject at ~3000ms regardless of the underlying connection
state, but manual verification against a real stopped Redis measured 7.263s. Not yet root-caused —
possibly the underlying TCP connection attempt itself takes longer than expected to fail in this
environment (Docker Desktop's handling of a stopped container's port mapping may not produce an
instant `ECONNREFUSED`, similar to what originally produced the 21.1s figure this fix improved on).
Not blocking — still a ~3x improvement over the original 21.1s, and well within "fails fast, not
indefinite" — but the exact number doesn't yet match the intended design and is worth a follow-up
look.

**F10 investigation (2026-08-01, Phase B) — partially root-caused via source-level analysis; live
reproduction still needed to close fully.** Docker was not available in this session's sandbox, so
this could not be re-measured live — the findings below are from reading `withTimeout`'s and
BullMQ/ioredis's actual source, not a new live measurement.

- **`withTimeout`'s `Promise.race` mechanism is confirmed sound.** `RedisConnection.get client()`
  (`bullmq/dist/cjs/classes/redis-connection.js`) returns `this.initializing`, a promise created
  exactly once in the constructor and memoized for the connection's lifetime — every call to
  `this.scanQueue.client` returns that same promise object, not a fresh one. While Redis is down,
  ioredis's `retryStrategy` keeps retrying indefinitely (by design — this is what makes the
  connection self-heal without an `apps/api` restart, per F2's Round 2 fix), so
  `RedisConnection.waitUntilReady()`'s internal promise never resolves *or* rejects — it stays
  permanently pending for as long as Redis stays down. That means `withTimeout`'s `Promise.race`
  should always be won by its own `setTimeout(..., 3000)` branch, deterministically, at ~3000ms
  from whenever `checkRedisConnection()` is *called* — not from whenever the connection started
  retrying. Nothing in this code path should be capable of stretching that to 7.3s.
- **Real, previously-undocumented correction: the retryStrategy in effect here is BullMQ's own
  default, not ioredis's.** Prior comments (`health.service.ts`, `app.module.ts`) describe
  `retryStrategy` as "left at ioredis's own default." Reading `RedisConnection`'s constructor
  directly shows this isn't quite accurate: it builds its connection options via
  `Object.assign({ port, host, retryStrategy: (times) => Math.max(Math.min(Math.exp(times), 20000), 1000) }, opts)`
  — a *different* formula from ioredis's own raw default
  (`(times) => Math.min(times * 50, 2000)`, from `ioredis`'s own `RedisOptions.js`). Since
  `bullConnectionOptions()` (`app.module.ts`) never sets `retryStrategy` explicitly, `Object.assign`
  means BullMQ's formula is what's actually active for this connection — retries roughly every
  1000ms for the first ~7 attempts, growing exponentially only after that (`Math.exp(times)`
  doesn't exceed the 1000ms floor until `times` ≈ 7). Doesn't change F2's self-healing behavior
  (both defaults retry indefinitely), but it's the actual mechanism, not the one previously
  documented — worth correcting in the code comments whenever this is next touched.
- **The residual ~4.3s gap (7.3s observed vs. ~3s expected) could not be conclusively root-caused
  without live reproduction.** Given the `Promise.race` analysis above, the most plausible remaining
  explanation is still the one originally hypothesized: a slow, non-instant TCP-connect-refusal at
  the OS/Docker layer for a stopped container's published port (Docker Desktop for Mac's networking
  stack) delaying Node's own timer-firing granularity under contention from ioredis's concurrent
  background reconnect attempts — but this is a plausible mechanism, not a confirmed one.
- **Recommended reproduction recipe for whoever has Docker access**: instrument
  `checkRedisConnection()` with `performance.now()` immediately before and after the `withTimeout`
  call (not around the whole request, to rule out request-logger-middleware or client-side
  `curl`/DNS overhead as confounds — `request-logger.middleware.ts` was checked and is trivially
  fast, just a `Date.now()` and a header, ruled out as a contributor), then stop Redis
  (`docker compose stop redis`) and hit `GET /health/ready` directly. If the instrumented duration
  is still ~7.3s, the delay is inside `withTimeout`/the connection layer as hypothesized above and
  warrants a deeper look at Node's timer/libuv behavior under concurrent connection attempts. If the
  instrumented duration is close to 3000ms but the *end-to-end* request duration remains ~7.3s, the
  gap is downstream of `checkRedisConnection()` entirely (measurement methodology, network path, or
  something outside this function) and the investigation should redirect there instead.

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

- ~~Building the real "Connect Microsoft 365" onboarding flow (F1)~~ — resolved, see F1's updated
  entry in §2.
- ~~Redis command timeout (backend) + fetch timeout/`AbortController` (frontend) (F2)~~ — resolved,
  see F2's updated entry in §2.
- `HealthScore`-on-failed-scan gating fix (F3)
- Scan-comparison "resolved" labeling fix (F4)
- User-approval audit trail (F5)
- Worker error-logging stack-trace capture (F6)
- Orphaned `Queued` `ScanJob` recovery when `queue.add()` fails (F9, newly discovered)
- Root-causing the `/health/ready` ~7.3s-vs-3s timing gap (F10, newly discovered)
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

**Ready for production sign-off — no remaining blockers from F1 or F2.**

1. ~~F1 (onboarding)~~ — **resolved** (see §2).
2. ~~F2 (Redis graceful-degradation FAIL)~~ — **resolved** (see §2), confirmed live: fails fast
   during an outage and self-heals automatically once Redis returns, without an `apps/api` restart.

Before considering this fully closed operationally, recommend addressing **F9** (orphaned `Queued`
jobs) with reasonable urgency — F2's fix makes Redis outages fail fast, which paradoxically makes
F9 easier to trigger in practice (a fast failure during any real Redis blip now reliably leaves a
stuck job blocking that tenant's scans, whereas before the outage itself was rare enough this
never surfaced). F10 (the timing gap) and F3–F8 remain lower-priority, non-blocking follow-ups.

For an already-provisioned, single-tenant deployment, the system is in genuinely good shape —
scoring, scanning, governance, permissions, and tenant isolation all held up under rigorous,
evidence-based testing (direct DB verification, not just API-response trust) with zero
data-integrity issues found anywhere across 19 test sections and 60+ live requests.

---

# Remediation Plan

## Priority 1 — Phase 6 blockers (must fix before customer onboarding)

1. ~~**Build the "Connect Microsoft 365" onboarding entry point (F1).**~~ **DONE (2026-07-15).**
   Implemented as a frontend-only flow — no backend change. See F1's entry in §2 for the full
   implementation reference and `docs/decisions/0012-organization-onboarding-and-user-provisioning.md`'s
   2026-07-15 amendment for the design record, including the one deliberately deferred item (a
   server-side Graph app-role-assignment check, named future work, not a Phase 6 blocker).

## Priority 2 — Production hardening

2. ~~**Redis graceful-degradation fix (F2).**~~ **DONE (2026-07-16, closed via a corrective round).**
   See F2's entry in §2 for the full three-round story. The initial Phase 7 fix
   (`maxRetriesPerRequest`/`connectTimeout` + frontend `AbortController` timeout) reduced the
   original indefinite hang but did not provide a deterministic enqueue bound — investigation
   found `maxRetriesPerRequest` is a periodic, connection-wide retry-cycle mechanism, not a
   per-request timeout, so real latency still varied from `45ms` to `38s` depending on timing. The
   corrective round added an explicit request-level timeout directly around `queue.add()`
   (`apps/api/src/common/with-timeout.ts`, reused from the health-check fix), confirmed live across
   5 consecutive Redis-down attempts to land consistently at `10.00-10.03s`. Self-healing (no
   `apps/api` restart needed on Redis recovery) reconfirmed intact throughout.

3. ~~**F9 — Recover orphaned `Queued` `ScanJob` rows when `queue.add()` fails.**~~ **DONE
   (2026-07-16).** See F9's entry in §2 — a compensating write (not a cross-system transaction)
   marks the row `Failed` on any enqueue failure, reusing `recoverStaleScanJobs`'s existing shape.
   Confirmed live: zero orphaned rows across 5 consecutive outage attempts during F2's corrective
   verification, no manual DB intervention needed at any point.

## Priority 3 — Future improvements (not blocking, lower urgency)

10. **F10 — Root-cause why `/health/ready`'s Redis check takes ~7.3s against a real stopped Redis**
    instead of the ~3s its explicit `withTimeout` should bound it to. **Partially investigated
    (2026-08-01, Phase B)** — see F10's updated entry in §2 for the full source-level analysis.
    `withTimeout`'s `Promise.race` mechanism is confirmed sound (should deterministically bound the
    check to ~3000ms), and a real, previously-undocumented correction was found (the connection's
    actual `retryStrategy` is BullMQ's own default, not ioredis's raw default, since
    `bullConnectionOptions()` never overrides it). The residual ~4.3s gap itself is still not
    confirmed — Docker was unavailable in this session to reproduce live. A specific reproduction
    recipe is documented in §2 for whoever next has Docker access.

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
6. ~~**F6 — Capture the full error/stack in worker site-collection failure logs**~~ **DONE
   (2026-08-01, Phase B).** `document-collector.processor.ts`'s two remaining `message`-only catch
   sites (site enumeration, per-document persist) now pass `error.stack` as the `Logger.error`
   trace argument, matching the `(message, stack)` shape `onFailed`/`onError` already used.
7. **F7 — Investigate the Entra App Registration's optional-claims config** so ID tokens reliably
   carry an `email` claim (low priority — email is already documented as display-only, never used
   for identity/authorization per ADR-0011).
8. ~~**F8 — Add a test exercising `AssigneeChanged`** (re-assigning an already-assigned issue)~~
   **Verified already covered (2026-08-01, Phase B).** `governance-issues.service.spec.ts` already
   has both a reassignment test (`user-1 → user-2`, asserting `AssigneeChanged` not `IssueAssigned`)
   and an unassign test (`user-1 → null`), added in Phase 8C (commit `4306ef7`) — before this LAT
   cycle ran. The original F8 finding referred to this scenario not being exercised *live* during
   manual QA click-through, not a missing automated test; no new test was added to avoid a
   redundant duplicate of existing, passing coverage.
9. Live-verify worker-crash-mid-scan recovery and BullMQ job-retry behavior in a later, dedicated
   session (accepted as code-audited-only this cycle, not because it's low-risk, but because it
   wasn't prioritized for live disruption this round).
