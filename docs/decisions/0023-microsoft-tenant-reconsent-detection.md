# ADR-0023: Microsoft Tenant Re-Consent Detection

Date: 2026-08-20
Status: Implemented (2026-08-21) — see §9 for exact deviations from the original design and full validation results.

> **Lineage note (2026-09-12):** this ADR's re-consent model is now load-bearing
> for the review-date write-back MVP (ADR-0022 / ADR-0003 2026-09-12 amendment).
> `REQUIRED_PERMISSION_VERSION` moved `1 → 2` when `Sites.ReadWrite.All` became
> required, so `derivePermissionReconsentState` now flags every v1-only tenant as
> `needsReconsent`. The write-back feature reads the write-specific slice of this
> exact model — `needsWriteConsentAssertion`, surfaced on `/auth/me` as
> `needsWriteConsent` — to gate remediation (authoritatively in the API, and
> proactively in the UI). No second consent concept was introduced; this is the
> first consumer that acts on the write signal rather than only displaying a
> combined banner.

---

## 1. Problem Statement

ADR-0003's 2026-08-13 amendment named a required investigation before Phase 3A-2 (bulk remediation, ADR-0022) could begin: does re-running Microsoft's admin-consent flow for an **already-connected** tenant correctly upgrade its grant when a new scope (`Sites.ReadWrite.All`) is added to the app registration's manifest? That investigation ran to completion in ADR-0003 (its "Investigation (2026-08-20)" sections) with **live evidence, not just source-code inference**:

- Microsoft/Entra genuinely supports re-consent for an already-connected tenant (confirmed twice: once via Azure Portal's "Grant admin consent" button, once through this codebase's own `/connect` → `/adminconsent` redirect).
- This codebase's own flow completes without error for that case — but only because `resolveOrProvisionFromConsent`'s identity-first check (`packages/database/src/onboarding.ts:154-162`) resolves any already-known admin as `kind: 'existing'` and returns immediately, before ever reaching a `MicrosoftTenant`/Graph-verification code path.
- Confirmed live: this produces `kind: "existing"`, a direct landing on `/dashboard`, no discovery re-trigger, and **no audit log entry** for the event.
- Nothing in the current codebase detects, verifies, or records that a re-consent happened, or what was granted.

This ADR is the design decision that closes that gap. It assumes ADR-0003's findings as established fact and does not re-litigate them.

## 2. Current Limitation (carried forward from ADR-0003)

- No single place in code declares which Graph scopes this application currently requires — only the Azure app registration manifest (external, out-of-band) and prose in `.claude/context/microsoft-graph.md`/ADR-0003 describe it, with nothing enforcing agreement between them.
- `MicrosoftTenant` (`prisma/schema.prisma:258-283`) records only a connection-lifecycle tri-state (`PendingConsent | Consented | Revoked`) — no field represents "which permission set has been confirmed for this tenant."
- `GraphConsentVerifierService.verifyTenantConsent` (`apps/api/src/auth/graph-consent-verifier.service.ts:35-38`) performs one real, cheap, read-scoped Graph call (`listSites().next()`) — but only at first-bootstrap time, never on re-visit or periodically.
- `resolveOrProvisionFromConsent`'s `existing`/`provisioned-pending` branches never call that verifier at all.
- `ConsentCallbackController` only writes an `AuditLog` row for `kind: 'bootstrapped'` (`apps/api/src/auth/consent-callback.controller.ts:59-73`) — every other resolution is silent.
- `/connect/page.tsx:44-51` auto-redirects an already-resolvable authenticated user straight to `/dashboard`, meaning an existing Admin cannot even reach the "Connect Microsoft 365" button without deliberately signing out first (confirmed live, this session).

## 3. Decision

### 3.1 Keep `MicrosoftTenant.status` as the connection lifecycle only — do not add `NeedsReconsent` as a status value

ADR-0012's 2026-07-20 amendment named `NeedsReconsent` as a plausible future `MicrosoftTenantStatus` value. **Rejected here.** `status` answers one question — is the connection alive at all (`PendingConsent`/`Consented`/`Revoked`). Whether a `Consented` tenant's granted permissions satisfy this application's *current* requirements is an orthogonal question — a tenant can be simultaneously `Consented` (connection healthy) and behind on a newer scope. Folding both into one enum would force a state-machine transition onto something that isn't a lifecycle event, and this codebase already has an established, better-fitting pattern for exactly this shape of problem: `classifyReviewDateHealth`/`stillDetected` are derived at read time, never stored as an enum (`packages/scoring`, `governance-issues.service.ts`). `needsReconsent` (§3.4) follows that precedent instead.

### 3.2 A required-permission version, declared once in code — not persisted

Add one small, explicit constant (exact module TBD at implementation time — `packages/config` or `packages/graph-client` are the natural candidates, since both are already shared by `apps/api`/`apps/worker`):

```ts
export const REQUIRED_GRAPH_PERMISSIONS = {
  read: ['Files.Read.All', 'Sites.Read.All'],
  write: ['Sites.ReadWrite.All'],   // required only once ADR-0022's bulk remediation ships
} as const;
export const REQUIRED_PERMISSION_VERSION = 1;
```

This is application configuration, describing what *this application* currently requires — the Azure app registration manifest remains the actual authority for what Microsoft has been asked to grant; this constant must be kept in sync with it by whoever edits the manifest, the same discipline already implicitly required between the manifest and `.claude/context/microsoft-graph.md` today, just now made explicit and machine-checkable against tenant state. **Not persisted to the database** — the database should only ever record what has been confirmed *about a given tenant*, never restate the requirement itself (see §3.3 for why conflating the two was the actual defect in the original proposal).

### 3.3 The semantic correction: two tenant-side fields, not one — resolving the `grantedPermissionVersion` naming issue

The initial design proposed a single `grantedPermissionVersion: Int?`. **This is rejected, not merely renamed**, because it cannot honestly represent both halves of `REQUIRED_GRAPH_PERMISSIONS`:

- **Read scopes are independently, cheaply verifiable** — `GraphConsentVerifierService`'s existing `listSites().next()` call is real evidence.
- **Write scopes are not independently verifiable without a cost this project has already, deliberately declined to pay**: either requesting `Directory.Read.All`/`Application.Read.All` to self-inspect the service principal's granted app roles (rejected — ADR-0012's amendment deliberately withholds these, for sound least-privilege reasons this ADR does not reopen), or performing a synthetic write purely to test permission (rejected — an unjustified mutation with its own risk, for a question that already has a designed, honest answer: ADR-0022 §9's reactive per-item `GraphPermissionError` handling, which treats the first *real* write's outcome as the check).

A single version field would inevitably be bumped by a mechanism (the read-only periodic health check, §3.5) that never actually touched the write scope — silently fabricating "verified" status for something never checked. Renaming the single field to `verifiedPermissionVersion` does not fix this; it is the same conflation under a more confident-sounding name.

**Decision: exactly two fields on `MicrosoftTenant`, not one, and not per-scope-string granularity:**

```prisma
verifiedReadPermissionVersion    Int?
consentAssertedPermissionVersion Int?
consentAssertedAt               DateTime?
```

(Schema shown for design clarity only — no migration is created by this ADR.)

- **`verifiedReadPermissionVersion`**: advanced *only* when `GraphConsentVerifierService` (or its extension) makes a real Graph call that succeeds, proving the read scopes required as of that version genuinely work. This is real evidence, and the name says exactly that.
- **`consentAssertedPermissionVersion`** / **`consentAssertedAt`**: advanced *only* when a real, successful (`admin_consent=True`, no `error`) admin-consent redirect completes through this application's own `/adminconsent`/callback flow — which ADR-0012 already established is reachable only via this one dedicated path (`POST /auth/consent-callback` is never a generic sign-in endpoint). This honestly records "the admin completed a real Microsoft consent dialog for this required version" — and nothing more. It is **not** proof of the effective write grant, and must never be presented as such in any API response, UI copy, or audit message.

No further per-scope splitting is introduced — the read/write verifiability asymmetry is the only distinction this system can currently act on differently, and is the sole justification for two fields instead of one. Tracking individual scope names would be complexity with no decision it enables, which this ADR explicitly avoids per its own smallest-model instruction.

### 3.4 `needsReconsent` — derived, not stored, and precise about which signal governs which claim

```
needsReadReconsent        = (verifiedReadPermissionVersion ?? 0)    < REQUIRED_PERMISSION_VERSION
needsWriteConsentAssertion = (consentAssertedPermissionVersion ?? 0) < REQUIRED_PERMISSION_VERSION
```

computed only for `status === 'Consented'` tenants (a `PendingConsent`/`Revoked` tenant's answer is moot — completing consent today grants whatever the manifest currently declares, so brand-new bootstraps and post-revocation reconnects start at the current version with no separate tracking needed).

- `needsReadReconsent` is a **real, enforceable signal** — backed by live Graph evidence — and could in principle gate core functionality if a future *read* scope ever changed (not applicable today, since `Files.Read.All`/`Sites.Read.All` are not changing, but this keeps the model correct for that hypothetical).
- `needsWriteConsentAssertion` is an **optimistic, UX-only signal** — it governs whether to show a "you may need to grant an additional permission" gate on a write-dependent feature (bulk remediation), and must never be treated as a security control. The actual enforcement for write scopes remains, unchanged, ADR-0022 §9's reactive per-item `GraphPermissionError` handling.
- A single UI-facing `needsReconsent` may be exposed as `needsReadReconsent || needsWriteConsentAssertion` for simple banner-rendering, but the two underlying signals must stay distinguishable in any API/audit surface that needs to reason about "how sure are we."

### 3.5 The periodic health check may only ever advance the read field

ADR-0012's 2026-07-20 amendment already runs a tenant-wide health check every 15 minutes (a cheap, read-scoped `GET /organization` call, used to detect `Revoked`). Extending this same tick to also refresh `verifiedReadPermissionVersion` (when its live check passes and the constant is ahead of the stored value) is correct and cheap — reusing an already-scheduled, already-read-scoped call. **It must never be allowed to advance `consentAssertedPermissionVersion`** — that field only ever moves in response to an actual completed OAuth consent redirect, never a passive background check. This is the direct, load-bearing answer to "can the health check advance the version when a newly-added permission is write-only": no, structurally, because the health check's own Graph call never touches write scopes, and the two-field split (§3.3) is precisely what makes that boundary explicit and hard to violate by accident.

### 3.6 Graph-unavailable / inconclusive verification

Extends `ConsentVerifier`'s existing, already-correct contract (`onboarding.ts`'s documented handling: a `ConsentVerificationError` means "consent missing," anything else — throttling, outage, unexpected error — propagates untouched and must never be silently treated as "consent is missing"). Applied here: a Graph outage during a `verifiedReadPermissionVersion` refresh attempt (bootstrap, `/connect` revisit, or the periodic tick) leaves the stored value **unchanged** — stale-but-not-downgraded — never reset to null, never treated as a fresh failure. `consentAssertedAt` (§3.3) gives a way to reason about staleness ("permissions last confirmed on `<date>`") without needing a separate inconclusive/error state value.

### 3.7 Existing-tenant callback behavior

`resolveOrProvisionFromConsent`'s `existing`/`provisioned-pending` branches gain a best-effort refresh step — same "logged, never rethrown" pattern already used for the discovery-enqueue failure path (`consent-callback.controller.ts:75-80`) — calling the extended `GraphConsentVerifierService` to refresh `verifiedReadPermissionVersion`. Separately, and unconditionally for **any** non-`rejected` resolution reached through this endpoint (`bootstrapped`/`existing`/`provisioned-pending`), `consentAssertedPermissionVersion`/`consentAssertedAt` advance to the current `REQUIRED_PERMISSION_VERSION` — because reaching this endpoint at all means a real admin-consent redirect was just completed (ADR-0012 already established this endpoint has exactly one call site). Neither write is required to succeed for sign-in to proceed.

### 3.8 No new backend endpoint — one new frontend entry point

The OAuth mechanics (`buildAdminConsentUrl`, the dedicated redirect URI, the callback) are identical for brand-new bootstrap, reconnect-after-`Revoked` (ADR-0012's named-but-unbuilt `POST .../reconnect`), and refreshing an already-`Consented` tenant's permissions — only `resolveOrProvisionFromConsent`'s existing branching differs, and it already branches on tenant/user state. **No separate reconnect endpoint is introduced.** The actual gap is `/connect/page.tsx`'s own auto-bounce (`:44-51`), which prevents an already-resolvable Admin from ever reaching the button. The fix is a **Settings-page entry point**, Admin-only, visible for already-`Consented` tenants, that drives the same `buildAdminConsentUrl()`/redirect flow without that bounce — naturally serving both the revoke-reconnect case and the permission-refresh case with one mechanism.

### 3.9 Auditability

One new `AuditLogAction` value (exact name TBD at implementation, e.g. `microsoft_tenant.permission_refreshed`), written **only** when `consentAssertedPermissionVersion` actually advances — a deliberate, rare, real event (an admin completed the consent flow again). **Never** written for a routine `verifiedReadPermissionVersion` refresh via the passive 15-minute tick — that would fire constantly and be pure noise, the same principle ADR-0021 already applied when rejecting a `ResolutionNoteUpdated` notification trigger. A failed/inconclusive verification attempt is logged via the ordinary application `Logger`, not the org-facing audit trail, matching the existing best-effort discovery-enqueue failure precedent.

### 3.10 API/DTO shape (proposed, not implemented)

- `ConsentResolution` gains one additive, optional field for non-`rejected` kinds — a simple `needsReconsent: boolean` (§3.4's combined signal) is sufficient for UI banner-rendering; the finer-grained `needsReadReconsent`/`needsWriteConsentAssertion` split stays an internal concept unless a concrete consumer needs to distinguish them.
- No new `ConsentResolution.kind` variant — "permissions still missing" is a property of an otherwise-successful resolution, not a distinct outcome, and would force every exhaustive-switch consumer (`finishing/page.tsx:131-136`) to handle a case that's purely informational.
- `ConsentCallbackRequest` is not changed — carrying Microsoft's raw `admin_consent`/`tenant` redirect values through to the backend was considered and rated low-value: per §3.7, the backend already treats *reaching this endpoint at all* as sufficient evidence a real redirect just succeeded.

## 4. What can be reused (no changes required)

- `GraphConsentVerifierService`'s existing `listSites().next()` call — extended in place, not replaced.
- The existing 15-minute tenant-wide health-check tick (ADR-0012, 2026-07-20 amendment).
- `ConsentVerifier`'s existing error-propagation contract (§3.6).
- `buildAdminConsentUrl`/`adminConsentRedirectUri`/the dedicated callback route — entirely unchanged plumbing, reused for the new Settings entry point.
- ADR-0022 §9's per-item `GraphPermissionError` classification — remains the sole real enforcement for the write scope; this ADR does not duplicate or replace it.
- The existing `AuditLog` write pattern (`AuditLogService.record`) and its `actorUserId`/`targetType`/`targetId`/metadata shape.

## 5. Minimum viable implementation (not started — requires separate approval)

1. `REQUIRED_GRAPH_PERMISSIONS`/`REQUIRED_PERMISSION_VERSION` constants.
2. Additive migration: `MicrosoftTenant.verifiedReadPermissionVersion Int?`, `consentAssertedPermissionVersion Int?`, `consentAssertedAt DateTime?`. No enum change, no new table.
3. Extend `GraphConsentVerifierService` (or add a narrowly-scoped sibling) to report a pass/fail usable to set `verifiedReadPermissionVersion`.
4. Wire the best-effort refresh (§3.7) into `resolveOrProvisionFromConsent`'s `existing`/`provisioned-pending` branches, and the unconditional `consentAssertedPermissionVersion` bump for any non-`rejected` resolution.
5. Extend the existing periodic health-check tick to also refresh `verifiedReadPermissionVersion` only (§3.5).
6. Add the derived `needsReadReconsent`/`needsWriteConsentAssertion`/`needsReconsent` computation.
7. Add the new `AuditLogAction` value, written only per §3.9.
8. Add the optional `needsReconsent` field to `ConsentResolution`.
9. Build the Settings-page entry point (§3.8) — reuses existing OAuth plumbing, bypasses `/connect`'s bounce.
10. Gate the bulk-remediation UI (ADR-0022, separately gated already) on `needsReconsent`, banner-only, never blocking core functionality.

## 6. Risks

- **`consentAssertedPermissionVersion` being mistaken for proof of the write grant** is the exact failure mode this ADR exists to prevent — mitigated structurally (a differently-named field, never merged with `verifiedReadPermissionVersion`) and must also be mitigated in any future UI copy/API documentation that surfaces it: it must always be described as "admin completed the consent step," never "write access confirmed."
- **Two fields instead of one is marginally more implementation surface** — accepted, because the alternative (one field) is not simpler, it is wrong: it would necessarily either overclaim write-scope verification or underclaim read-scope verification.
- **The Settings entry point is new UI surface with no precedent in this codebase's onboarding flow** — mitigated by reusing 100% of the existing OAuth mechanics; only the trigger point and the bounce-bypass are new.

## 7. Non-Goals

- Independently verifying `Sites.ReadWrite.All` without a real write — not solved here, and not solvable without reopening `Directory.Read.All`/`Application.Read.All` (out of scope, a separately-justified future decision if ever pursued) or accepting ADR-0022's reactive model (accepted, unchanged).
- Per-individual-scope tracking (a granted-scopes array/table) — rejected as unnecessary granularity (§3.3).
- A new `MicrosoftTenantStatus` value — rejected (§3.1).
- A separate `reconnect` backend endpoint — rejected (§3.8).
- Any change to `RemediationJob`/`RemediationItem`/`SetReviewDateAction` (ADR-0022) — untouched by this ADR.

## 8. ADRs Requiring Amendment

- **ADR-0003** — this ADR is the design resolution to the investigation recorded there (2026-08-20 sections); no further amendment to ADR-0003 itself is needed, this ADR stands alongside it.
- **ADR-0012** — the `NeedsReconsent` status value it named as a future possibility (2026-07-20 amendment) is superseded by this ADR's §3.1 decision not to add it; the reconnect-endpoint idea it named is superseded by §3.8's decision to reuse `/connect` via a new frontend entry point instead.
- **ADR-0022** — unaffected; its §9 reactive per-item write-verification model is reused as-is (§4), not modified.

## 9. Implementation Notes (2026-08-21)

Implemented per §5's plan, with two deliberate deviations discovered and resolved during implementation — both reported before proceeding, per this work's own ground rule not to silently redesign around a contradiction.

### Deviation 1 — §3.5's periodic health-check tick does not exist

§3.5 assumed extending "the existing 15-minute tenant-wide health-check tick (ADR-0012, 2026-07-20 amendment)." Direct inspection at implementation time found that tick was never actually built — ADR-0012's 2026-07-20 amendment documented a `Consented → Revoked` health check (a `GET /organization` Graph call, a `revokedAt` field) that, like `NeedsReconsent`, was named but never implemented. The only real 15-minute repeatable job in the codebase (`apps/worker/src/scheduler/scheduler.processor.ts`) does something unrelated (fires due `ScanSchedule`s) and makes no Graph calls at all.

**Resolved by explicit user decision**: skip the periodic-refresh piece entirely for this round. `verifiedReadPermissionVersion` only refreshes via the consent-callback flow (§3.7, implemented as designed). Building ADR-0012's own health check is out of scope here — a separate, larger, unapproved piece of work. This means a `Consented` tenant that never revisits `/connect` or the new Settings entry point will not have its `verifiedReadPermissionVersion` refreshed passively; only an active visit refreshes it. Not a correctness problem (§3.6's "never treat unknown as denied" rule still holds — it just means `needsReadReconsent` can stay `true` longer than it would with a periodic check), but worth naming as a real, accepted limitation.

### Deviation 2 — the best-effort refresh lives in the controller, not inside `resolveOrProvisionFromConsent`

§3.7 described the refresh as happening inside `resolveOrProvisionFromConsent`'s `existing`/`provisioned-pending` branches. Implementation found a direct, deliberate, already-existing test guarding against exactly that: `packages/database/src/onboarding.spec.ts`'s *"does not invoke the verifier for an already-existing user or an already-connected tenant (verification only gates brand-new bootstrap)"* — asserting `verifyTenantConsent` is never called on those branches, a guarantee this ADR should not weaken.

**Resolved without changing that guarantee**: the best-effort read-verification refresh and the unconditional consent-assertion write both live in `ConsentCallbackController` (`apps/api/src/auth/consent-callback.controller.ts`), called *after* `resolveOrProvisionFromConsent` returns, using the same injected `GraphConsentVerifierService` instance. `resolveOrProvisionFromConsent` itself is untouched — its existing test suite passes unmodified. This is a placement detail, not a design change: the refresh still happens exactly once per callback, still best-effort, still never blocks sign-in.

### What was built, exactly as designed

- `MicrosoftTenant.verifiedReadPermissionVersion Int?` / `consentAssertedPermissionVersion Int?` / `consentAssertedAt DateTime?` — additive migration, all nullable, no backfill (`prisma/migrations/20260820120000_add_microsoft_tenant_permission_state`).
- `REQUIRED_GRAPH_PERMISSIONS` / `REQUIRED_PERMISSION_VERSION` (`packages/database/src/graph-permissions.ts`) — the single source of truth, per §3.2. Not placed in `packages/config` (env-schema-only today) or `packages/graph-client` (`packages/database` cannot depend on it — the same purity rule protecting `ConsentVerifier`); co-located instead with the other consent/permission logic already in `packages/database`.
- `derivePermissionReconsentState`, `applyVerifiedReadPermission`, `applyConsentAssertion` (`packages/database/src/permission-state.ts`) — exactly the two-field model from §3.3/§3.4, with `applyVerifiedReadPermission`/`applyConsentAssertion` implemented as single conditioned `updateMany` calls (never regress a higher stored version, and the caller learns whether anything actually advanced from one atomic operation rather than a separate read-then-write).
- `ConsentCallbackController` (§3.7): unconditional consent-assertion write for every non-rejected resolution; best-effort read-permission refresh, skipping a redundant Graph call for `'bootstrapped'` (already proven inside `resolveOrProvisionFromConsent`'s own pre-bootstrap gate) and re-verifying live for `'existing'`/`'provisioned-pending'`; a `ConsentVerificationError` or any infrastructure error leaves `verifiedReadPermissionVersion` untouched, exactly per §3.6.
- `'microsoft_tenant.permission_consent_asserted'` audit action (`packages/types/src/api/audit-log.ts`), written only when `applyConsentAssertion` reports `advanced: true` — confirmed by test that a repeat call at the same version produces no duplicate entry.
- `ConsentResolution.needsReconsent` (both `packages/database` and its `packages/types` mirror) and `MeResponse.needsReconsent` (`GET /auth/me`, computed from the same tenant row already fetched — no extra query) — additive.
- Settings entry point (§3.8): `apps/web/src/app/dashboard/settings/page.tsx`, Admin-only (client-side gate, matching `dashboard/users`/`dashboard/sharepoint`'s existing convention), reusing `buildAdminConsentUrl`/`adminConsentRedirectUri`/`startConnectFlow` verbatim — zero new OAuth code, zero new backend endpoint. Added to `dashboard-nav.tsx`'s existing Admin-only "Administration" group.

### Two small adjacent fixes made while touching these files (not part of ADR-0023's design, flagged separately)

- `packages/types/src/api/consent-callback.ts`'s `ConsentResolution` mirror was missing the `'graph-consent-not-verified'` rejection reason that `packages/database`'s real type has carried since ADR-0012's 2026-08-01 amendment — a pre-existing drift bug, corrected while adding `needsReconsent` to the same union. Confirmed no frontend code switched exhaustively on `reason` (only compares against literals), so this is a strict widening with no behavior change.
- `MeResponse.needsReconsent` and `ConsentResolution.needsReconsent` are both **optional**, not required as originally sketched in §3.10 — required would have broken every existing test fixture across `apps/web` that constructs a `MeResponse`/`ConsentResolution` literal (four test files). Optional is additive and the real backend always populates it regardless.

### Validation

Full monorepo, `pnpm exec turbo run typecheck lint test build --continue`, twice (once with a fresh `--force` test run, no cache): **37/37 tasks green**. Test totals: `@sph/config` 9, `@sph/scoring` 46, `@sph/graph-client` 53, `@sph/review-date-discovery` 39, `@sph/database` 96 (80 prior + 16 new — `permission-state.spec.ts`, real Postgres), `@sph/worker` 124 (unchanged, untouched by this ADR), `@sph/api` 500 (483 prior + 17 new across `consent-callback.controller.spec.ts`/`me.controller.spec.ts`), `@sph/web` 508 (502 prior + 6 new — `dashboard/settings/__tests__/page.test.tsx` plus extended nav assertions). 1375 tests total, 0 failures. The migration was applied via `prisma migrate deploy` against this session's reachable Postgres instance.

### Live E2E confirmation (2026-08-21)

The full flow was exercised live, through the actual `/dashboard/settings` entry point, against the same real tenant used for ADR-0003's original investigation (which had never gone through the post-ADR-0023 code, so `verifiedReadPermissionVersion`/`consentAssertedPermissionVersion` both started `NULL`). Confirmed:

- The Settings page renders correctly for an Admin — connected tenant name, the "needs refresh" banner (since both fields were `NULL`), and the refresh button.
- Clicking "Refresh Microsoft 365 permissions" reused the real `/adminconsent` redirect and completed the same flow already validated in ADR-0003.
- Post-callback, `consentAssertedPermissionVersion`/`consentAssertedAt` were set, `verifiedReadPermissionVersion` was set (the live Graph re-check succeeded), `GET /auth/me` returned `needsReconsent: false`, and the "needs refresh" banner disappeared.
- A `microsoft_tenant.permission_consent_asserted` audit entry appeared for the first pass.
- **Idempotency confirmed live**: running the same flow a second time produced no second audit entry and no change to `consentAssertedAt`.
- **Authorization confirmed live**: the Settings nav link and page are both correctly absent for a non-Admin account.

This closes out ADR-0023 end to end — every claim in §9's implementation notes is now backed by live observation, not just tests, for the one real tenant available. Status unchanged: **Implemented**. §5's plan is complete except for the periodic-refresh piece (Deviation 1, explicitly descoped) — no other part of §3 was skipped or altered from what was approved.
