# ADR-0023: Microsoft Tenant Re-Consent Detection

Date: 2026-08-20
Status: Accepted (design) — no code, schema, migration, endpoint, or UI implemented yet. Implementation requires separate, explicit approval per section 5's plan.

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

Status: **Accepted (design)**. No code, schema, migration, endpoint, or UI has been implemented. Implementation requires separate, explicit approval of the plan in §5.
