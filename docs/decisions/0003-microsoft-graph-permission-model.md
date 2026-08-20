# ADR-0003: Microsoft Graph Permission Model

Date: 2026-07-11
Status: Accepted (updated 2026-07-11 with Entra ID application tenancy model)

---

## Problem

Documentation is inconsistent on required Graph permissions. `.claude/context/microsoft-graph.md` specifies read-only scopes (`Files.Read.All`, `Sites.Read.All`), while `docs/api/microsoft-graph.md` additionally lists `Sites.ReadWrite.All`. The product only reads and scores documents in MVP — there is no documented feature that writes back to SharePoint.

## Context

- Security rules mandate least privilege (`security.md`, `.claude/context/security.md`).
- This is enterprise software; customer security/IT teams review requested Graph permissions during procurement. Unjustified write scopes are a common blocker in enterprise sales cycles.
- Scans need to run without an interactively signed-in user present (see ADR-0004), which affects whether permissions must be delegated or application-level.

## Options Considered

**A. Application (app-only) permissions, read-only — `Files.Read.All`, `Sites.Read.All`**
Works for background/unattended scans triggered on demand or on a schedule. Requires tenant admin consent at onboarding, but that's a one-time step. Matches actual MVP capability (read + score, no writes).

**B. Add `Sites.ReadWrite.All`**
Would allow writing scores or metadata back into SharePoint (e.g., a custom column showing health score). No such feature exists in MVP scope. Requesting it anyway violates least privilege and adds unnecessary review friction for customers.

**C. Delegated permissions (act as the signed-in user)**
Ties every scan to a logged-in user's session and token lifetime — incompatible with an on-demand or scheduled background scan job that should work independent of any one user being online.

## Recommended Decision

**Option A.** Use **application (app-only) permissions**, read-only: `Files.Read.All` and `Sites.Read.All`, granted via tenant admin consent during customer onboarding. Drop `Sites.ReadWrite.All` from the MVP permission request entirely; correct `docs/api/microsoft-graph.md` to match `.claude/context/microsoft-graph.md`.

## Tradeoffs

- App-only permissions require an upfront tenant-admin-consent step (heavier onboarding than a simple user login), but this is unavoidable for any unattended/background scanning capability and is standard for this category of enterprise integration.
- Read-only scope minimizes the blast radius of a compromised app registration or leaked credential, and simplifies the security conversation with customer IT/security teams.

## Future Considerations

- If a future feature needs to write back to SharePoint (e.g., a health-score custom column, or automated remediation actions), request the additional write scope as a separate, explicitly-justified consent step at that time — not bundled into initial onboarding.
- Document the admin consent URL/flow and required tenant configuration in `docs/api/microsoft-graph.md` once the Entra app registration is created.

---

## Addendum: Entra ID Application Tenancy Model (2026-07-11)

### Problem

The Entra ID app registration itself can be configured as single-tenant (only one specific Azure AD tenant can consent/sign in) or multi-tenant (any organization's Azure AD tenant can grant consent). This wasn't decided in the original ADR.

### Options Considered

**A. Single-tenant app registration**
Would require a separate Entra app registration per customer, defeating the "no per-customer app registrations" requirement and multiplying operational overhead (secret rotation, consent flows, monitoring) per customer.

**B. Multi-tenant app registration**
One Entra app registration, owned by us, that any customer's Azure AD tenant can grant admin consent to. Standard pattern for enterprise SaaS integrating with Microsoft 365.

### Decision

**Option B.** A single multi-tenant Entra ID application. Each customer organization:

1. Authenticates against their own Azure AD tenant (never ours).
2. Has a tenant admin grant admin consent to our app for the scopes in this ADR (`Files.Read.All`, `Sites.Read.All`, app-only).
3. Is represented internally by a `MicrosoftTenant` record linked to their `Organization` (see ADR-0007), capturing their Entra tenant ID and consent status.
4. Has all data isolated via `organizationId` (ADR-0001) — the multi-tenant app registration is purely an auth/consent mechanism and has no bearing on data isolation, which is enforced entirely at the application/database layer.

No per-customer app registrations are supported or planned.

### Tradeoffs

- A single shared app registration means a compromised client secret affects all customers simultaneously — mitigated by Key Vault-backed storage (ADR-0006) and standard secret rotation practice.
- Simplifies operations dramatically versus provisioning and maintaining a distinct Entra app per customer, and matches how virtually every enterprise Microsoft 365 SaaS integration is built.

### Future Considerations

- If a specific customer's compliance requirements ever mandate a dedicated app registration, that would be handled as a customer-specific exception, not a change to the default model.

---

## Amendment (2026-08-13 — Sites.ReadWrite.All for Bulk Remediation, Phase 3A-2)

This activates the option this ADR's own original Future Considerations
section already named: *"If a future feature needs to write back to
SharePoint (e.g.,... automated remediation actions), request the
additional write scope as a separate, explicitly-justified consent step
at that time — not bundled into initial onboarding."* Bulk remediation
(ADR-0022) is that feature.

**This amendment documents the decision only — no consent flow, UI, or
Graph permission change is implemented in Phase 3A-0 or Phase 3A-1.**
Both remain entirely read-only, using only the existing `Files.Read.All`/
`Sites.Read.All` grant.

### Decision

Request `Sites.ReadWrite.All` (application permission) as an
**additional, optional, separately-consented** scope in Phase 3A-2 —
never bundled into the existing onboarding flow, never required to use
any existing product functionality. `Files.Read.All`/`Sites.Read.All`
remain the only scopes required for discovery, scanning, scoring, and
review-date sync/eligibility/confirmation to work at all.

### Backward compatibility — mandatory, not aspirational

A tenant that has not granted the new scope must continue functioning
identically to today: discovery, approval, scanning, scoring, and every
Phase 1/1.1/1.2/2/3A-1 review-date capability (sync, eligibility,
confirmation, the manual-write conflict guard) are entirely unaffected
by whether this scope has been granted. Bulk remediation's entry points
may remain visible but must show a clear, actionable "requires
additional permission" state rather than erroring unclearly or
disappearing silently.

### No pre-flight permission probe

Consistent with `GraphConsentVerifierService`'s existing design (a real
smoke-test call, not a directory-role-assignment probe — this app is
never granted `Directory.Read.All`/`Application.Read.All`, per ADR-0012's
amendment, so that path is closed regardless), this amendment does not
introduce a separate "check whether we have write permission" call. The
first real write attempt is the check: a 403 (`GraphPermissionError`,
ADR-0013's amendment) means the scope isn't granted, surfaced as one
per-item failure in the existing partial-failure model (ADR-0022), not
as new pre-flight machinery.

### Security/procurement framing

This is a genuine new procurement conversation for every existing
customer, not a quiet backend change — matches this ADR's own
foundational reasoning (§ "Context": *"customer security/IT teams review
requested Graph permissions during procurement... unjustified write
scopes are a common blocker"*). The scope is now justified by a specific,
narrow, reviewable feature (setting one date field on documents an admin
explicitly selects), meeting the bar this ADR's original Option B
rejection implicitly set: request a write scope only once a concrete,
justified feature exists, never speculatively.

### Explicitly deferred — required before Phase 3A-2 can begin

**The actual re-consent UI/UX mechanics are not designed by this
amendment and must not be guessed at.** The existing `/connect` flow
(ADR-0012's 2026-07-15 amendment) is bootstrap-only — it has never been
exercised for "add a scope to an already-connected tenant," and Microsoft's
admin-consent URL mechanics for that specific scenario need real
investigation (not assumption) before implementation: does re-running the
tenant-wide admin-consent URL with an expanded scope list correctly
upgrade an existing grant, or does it require a distinct flow? This is
listed as a required investigation/design prerequisite for Phase 3A-2,
not a solved problem — implementation of Phase 3A-2 must not begin until
this is resolved, either by a dedicated design pass or by live
experimentation against a real tenant.

## Investigation (2026-08-20) — re-consent mechanics, source-level findings

**Scope of this session**: source-code investigation only, no live-tenant
testing (Docker was unavailable in this sandbox — the same constraint
that limited the LAT report's F10 investigation). No schema, migration,
endpoint, or UI change is made by this section. This narrows the
prerequisite named above from "not started" to "source-level analysis
done; live verification still required" — it does not close it.

### What was investigated

Whether re-running Microsoft's `/adminconsent` endpoint for an
**already-connected** tenant, after `Sites.ReadWrite.All` is added to the
Azure app registration's manifest, correctly upgrades that tenant's
existing grant — and, separately, whether this codebase has anywhere to
observe, verify, or record that upgrade if it happens.

### Known (confirmed directly from source, not inferred)

- `buildAdminConsentUrl()` (`apps/web/src/lib/auth/connect-flow.ts:81-84`)
  builds `{AUTHORITY}/adminconsent?client_id=...&redirect_uri=...&state=...`
  — **no `scope` parameter is ever included**. `AUTHORITY` is
  `https://login.microsoftonline.com/organizations`
  (`apps/web/src/lib/auth/msal-config.ts:7`).
- This confirms the codebase already assumes the correct model for
  app-only permissions: Microsoft's v1 `/adminconsent` endpoint has no
  scope query parameter for this grant type at all — it consents to
  whatever the app registration's manifest (`requiredResourceAccess`)
  currently declares. Scopes are (per this ADR's original framing)
  implicit in the manifest, not passed by this code, which is the only
  correct way to build this URL for this permission model.
- Standard, well-documented Azure AD behavior for this consent type is
  that re-running admin consent after a manifest change presents the
  admin with the current (superset) permission list and, on approval,
  updates the app's service-principal grant tenant-wide. This is not this
  codebase's behavior to verify — it is Microsoft's platform contract —
  but it is the behavior the rest of this investigation's findings are
  measured against.

### Source-level gap — confirmed by reading the actual consent code path

Independent of whether Microsoft's side behaves as expected above, this
application currently has **no mechanism to**:

1. **Trigger a re-consent redirect for an already-connected tenant.**
   `ConsentCallbackController.handleConsentCallback`
   (`apps/api/src/auth/consent-callback.controller.ts:26-84`) only
   verifies the ID token and calls `resolveOrProvisionFromConsent`
   (`packages/database/src/onboarding.ts:147-196`). For a tenant that
   already has a `MicrosoftTenant` row, that function returns
   `{ kind: 'existing' }` immediately (`onboarding.ts:154-162`) — no
   distinct "this tenant re-consented with a new scope" path exists.
   `GraphConsentVerifierService.verifyTenantConsent` is only invoked on
   the brand-new-tenant branch (`candidates.length === 0`,
   `onboarding.ts:166-168`), never for `existing`/`provisioned-pending`.
2. **Record which scopes/permissions a tenant has been granted.**
   `MicrosoftTenant` (`prisma/schema.prisma:258-283`) has `status:
   MicrosoftTenantStatus` (`PendingConsent | Consented | Revoked`,
   `schema.prisma:49-53`), `consentGrantedAt`, `consentGrantedByUserId` —
   a binary/tri-state connection lifecycle, with no field of any kind for
   "which scopes." ADR-0012's 2026-07-20 amendment already names this
   precise gap and proposes (but does not implement) a future
   `NeedsReconsent` status for exactly this "consented, but missing a
   newer scope" case (`docs/decisions/0012-....md`, "A state this
   lifecycle does not yet need, but should be ready for: `NeedsReconsent`"
   section) — that ADR explicitly says "not built now — no code path
   produces or consumes it today."
3. **Verify the expanded permission set after a re-consent.**
   `GraphConsentVerifierService.verifyTenantConsent`
   (`apps/api/src/auth/graph-consent-verifier.service.ts:35-38`) calls
   `listSites(entraTenantId).next()` once — a smoke test of
   `Files.Read.All`/`Sites.Read.All` only, run once at first bootstrap.
   It has no `Sites.ReadWrite.All`-specific check, and this ADR's own
   2026-08-13 amendment already decided one should not be built as a
   pre-flight probe (the first real write's `403` is the intended check).
   There is accordingly no verification step anywhere for "was the new
   scope actually granted" at re-consent time, by design for the write
   path, but also by simple absence for the re-consent-detection path.
4. **Expose a reconnect/re-consent entry point to an existing tenant
   administrator.** ADR-0012's 2026-07-20 amendment names
   `POST /organizations/:id/microsoft-tenant/reconnect` as a pattern to
   build eventually, but **it does not exist in code today**, and — a
   distinction worth preserving precisely — that named endpoint is scoped
   to the `Revoked → Consented` reconnect case (a lapsed grant coming
   back), not the "already-`Consented`, needs one additional scope" case
   this ADR's Phase 3A-2 amendment actually needs. The two scenarios may
   end up sharing a mechanism, or may not; that is exactly the kind of
   choice this investigation section deliberately does not make (see
   "Deferred" below).

### Live evidence collected (2026-08-20)

A real test was run against a real Azure app registration and a tenant
that had **already granted consent before** this test (the correct prior
state — this is the re-consent scenario, not first-time consent):

1. `Sites.ReadWrite.All` was added to the app registration's manifest
   (`requiredResourceAccess`), alongside the pre-existing
   `Files.Read.All`/`Sites.Read.All`. The permissions blade showed the new
   permission with a caution icon ("Not granted for `<tenant>`"), while
   the pre-existing permissions remained shown as already granted.
2. An admin clicked **"Grant admin consent for `<tenant>`"** directly in
   Azure Portal (not via this codebase's `/adminconsent` redirect URL —
   see the caveat below). The caution icon turned into a green checkmark.

**What this confirms**: for a tenant with a pre-existing grant, having an
admin re-consent after the manifest gains a new permission does update
that tenant's grant to include the new scope — Microsoft's side does not
require a distinct flow or silently no-op the request. This resolves the
central protocol-level question this investigation opened with.

**What this does not yet confirm** — two caveats, kept distinct
deliberately rather than treated as closed:

- **Mechanism tested vs. mechanism this product uses.** The consent was
  granted via Azure Portal's own "Grant admin consent" button (an
  app-owner action against the app registration directly), not by an
  external tenant admin re-visiting this codebase's actual
  `buildAdminConsentUrl()` redirect (`connect-flow.ts:81-84`). Both
  ultimately drive the same Microsoft-side tenant-wide admin-consent
  grant mechanism, so this is expected to generalize, but the two entry
  points have not both been exercised — only the Portal-button path has.
- **Evidence source is the Portal UI, not a direct Graph call.** The
  green checkmark is Microsoft's own authoritative UI, but a direct Graph
  call confirming the service principal's granted app roles now include
  `Sites.ReadWrite.All` (or a real `Sites.ReadWrite.All`-only operation
  succeeding) would be stronger, code-independent proof. Not yet done.

Neither caveat is expected to change the answer — but per this
investigation's own ground rule (evidence over assumption), they stay
open until checked, not silently assumed resolved.

This is unchanged: nothing on this codebase's side observed or reacted to
this consent event — no code path in `resolveOrProvisionFromConsent`,
`GraphConsentVerifierService`, or anywhere else was exercised by this
test, because the test used the Portal button, not this product's
`/connect` flow. The source-level gaps in the "Source-level gap" section
above are entirely unaffected by this evidence.

### Still requiring live validation

The following can only be confirmed against a real Microsoft 365 tenant
and Azure app registration, not by reading source, and are not yet
resolved by the evidence above:

```text
Update app registration manifest (add Sites.ReadWrite.All)
        ↓
Existing tenant administrator
        ↓
Visits /adminconsent again (same tenant, same client_id)
        ↓
Microsoft presents the expanded permission set for approval
        ↓
Admin approves
        ↓
Our callback executes (today: resolveOrProvisionFromConsent, `existing` branch)
        ↓
Existing tenant is recognized  ← confirmed today, unconditionally
        ↓
Permissions are verified       ← NOT built today (finding 3 above)
        ↓
Tenant becomes eligible for SharePoint write operations
```

Specifically unverified:

- ~~Whether Microsoft actually re-prompts the admin with the new
  permission (vs. silently no-op'ing because the tenant is already
  recorded as consented) after only a manifest change.~~ **Resolved by
  the 2026-08-20 live evidence above**: yes, for an already-consented
  tenant, re-consenting updates the grant to include the new scope.
- Whether that same result holds specifically via **this codebase's own**
  `/adminconsent` redirect URL (`buildAdminConsentUrl()`), as opposed to
  the Azure Portal "Grant admin consent" button used in the test above —
  expected to be equivalent (both drive the same underlying Microsoft
  consent-grant mechanism), not yet independently confirmed.
- Whether the resulting Microsoft-side grant is independently
  confirmable via a direct Graph call (service-principal app-role
  inspection, or a real `Sites.ReadWrite.All` operation) rather than only
  the Portal UI's own checkmark.
- What Microsoft's redirect-back parameters look like for this specific
  scenario (re-consent on an existing tenant, via our own `/adminconsent`
  URL) versus first-time consent — `admin-consent-callback/page.tsx`
  today only handles the first-time shape, and this still hasn't been
  exercised through that page.

### Why live verification cannot be performed in this session

No Docker daemon is available in this sandbox (`docker info` fails), and
there is no real Microsoft 365 tenant or Azure app registration reachable
from this environment — the same constraint the LAT report's F10
investigation hit (`docs/testing/local-acceptance-testing-report.md`,
"Docker was not available in this session's sandbox"). Nothing in this
investigation required or attempted a live call.

### Evidence required to close this investigation

1. ~~A real Azure app registration's manifest, with `Sites.ReadWrite.All`
   added to `requiredResourceAccess`, in a test/dev tenant.~~ **Done
   (2026-08-20).**
2. ~~A tenant already in this product's `Consented` state (i.e., one that
   went through `/connect` before the manifest change).~~ **Done
   (2026-08-20)** — confirmed the test tenant had prior consent.
3. That tenant's admin re-visiting **this codebase's own, unmodified**
   `/adminconsent` URL (not the Azure Portal button) and a direct
   observation of Microsoft's response: does it show the expanded
   permission list, and does approving it update the grant? — the
   2026-08-20 test used the Portal button instead; this specific path
   through our own code is still unexercised.
4. A direct Graph call (e.g. a throwaway `Sites.ReadWrite.All`-only
   operation, or inspecting the service principal's granted app roles via
   Graph `servicePrincipals` API) confirming the new scope is actually
   present post-approval — not inferred from the Portal UI alone.
5. The exact shape of Microsoft's redirect-back query parameters for this
   specific re-consent-on-existing-tenant scenario, compared against
   first-time consent's shape — only obtainable by exercising item 3
   through `admin-consent-callback/page.tsx`.

### Deliberately deferred — not decided by this section

This investigation does not choose between, and no code should assume
any of the following until the evidence above exists:

- Whether `NeedsReconsent` (already named, unbuilt, in ADR-0012) is the
  right state to add, versus a different modeling choice.
- Whether/how to record granted scopes on `MicrosoftTenant` (a new field,
  a separate table, or something else).
- Whether the not-yet-built `Revoked → Consented` reconnect endpoint
  (ADR-0012, 2026-07-20 amendment) should be extended to also cover
  "add a scope to an already-`Consented` tenant," or whether that
  warrants a distinct endpoint.
- Whether `GraphConsentVerifierService` should be extended, or a separate
  verifier introduced, for any post-re-consent check.
- Any Settings UI entry point design for triggering this flow.

### Recommended next step

The central protocol-level question (does re-consent for an
already-connected tenant work at all) is now answered: yes. The remaining
gap is narrower — confirm the same result through this product's actual
`/connect`/`/adminconsent` code path (item 3 above) rather than the Portal
button, since that's the path real customers will use, and it's the only
way to observe what `admin-consent-callback/page.tsx` actually receives
back (item 5). That, plus a direct Graph-level confirmation (item 4), is
what's left before any of the "Deliberately deferred" decisions above
should be made or Phase 3A-2 implementation starts.

## Investigation (2026-08-20, continued) — does this codebase's own `/connect` flow handle re-consent?

**Method**: source-level trace only, no live browser execution this
session (no browser/credential access from this sandbox — see the
constraint noted earlier in this ADR). Every conclusion below marked
"confirmed" follows from code with no branching on live Microsoft
response content, so it is stated with high confidence despite not being
an observed transcript — this distinction is kept explicit per this
investigation's own evidence-over-assumption rule, and item 6 below names
exactly what would upgrade it from "code trace" to "observed."

### Exact flow, traced end to end

1. `/connect` (`apps/web/src/app/connect/page.tsx`) builds the
   admin-consent URL via `buildAdminConsentUrl()`
   (`connect-flow.ts:81-84`) — no `scope` parameter, as already
   established. Redirect target is a dedicated URI,
   `adminConsentRedirectUri()` (`connect-flow.ts:71-78`,
   `/connect/admin-consent-callback`).
2. Microsoft redirects back to that URI with, per its own documented v1
   `/adminconsent` contract, `admin_consent=True&tenant=<tid>&state=...`
   on success or `error=...&error_description=...&state=...` on
   rejection/cancellation.
3. `admin-consent-callback/page.tsx` reads exactly four query values:
   `admin_consent`, `state`, `error`, `error_description`
   (`admin-consent-callback/page.tsx:43-46`). **It never reads Microsoft's
   `tenant` query parameter at all** — confirmed by inspecting every
   `searchParams.get(...)` call in this file; only those four names
   appear anywhere in it. Whatever tenant ID Microsoft's redirect carries
   is discarded at this point without ever being read.
4. On success + a valid anti-replay `state`, the page renders "Permission
   granted" and a "Continue to sign-in" button, which starts a **separate**
   MSAL `loginRedirect()` (`admin-consent-callback/page.tsx:71-75`) —
   unrelated to `admin_consent`/`tenant`, carrying only the tenant *name*
   (not the consent result) forward in MSAL's own `state`.
5. That eventually reaches `/connect/finishing`
   (`finishing/page.tsx:140-153`), which calls `postConsentCallback(idToken,
   tenantName)` → `POST /auth/consent-callback` with a body of exactly
   `{ idToken, tenantName }` (`consent-callback.dto.ts:8-11`). **Nothing
   Microsoft returned in step 2 — not `admin_consent`, not `tenant`, not
   `state` — is ever sent to the backend.** The backend has no signal
   that a re-consent redirect happened at all; it only receives an ID
   token (from the unrelated MSAL sign-in step) and a client-supplied
   tenant name string.
6. Backend: `resolveOrProvisionFromConsent`
   (`packages/database/src/onboarding.ts:147-196`) runs
   `findUserByEntraIdentity(tid, oid)` **first**
   (`onboarding.ts:154`). For the admin who already has a `User` row (the
   same admin who originally connected this tenant — the realistic actor
   for a re-consent), this **immediately returns `{ kind: 'existing' }`**
   (`onboarding.ts:155-162`) and returns *before* the function ever
   reaches the `MicrosoftTenant` candidate lookup or calls
   `GraphConsentVerifierService.verifyTenantConsent` — that verifier is
   only invoked in the `candidates.length === 0` branch, for a tenant
   this database has never seen before (`onboarding.ts:166-168`).
   `MicrosoftTenant.status`/scopes are never read on this path.
7. Frontend: `finishing/page.tsx` routes `kind: 'existing'` identically to
   `kind: 'bootstrapped'` — `refetchCurrentUser()` then `/dashboard`
   (`finishing/page.tsx:116-124`) — **except** that only `'bootstrapped'`
   writes an `AuditLog` row or re-triggers discovery
   (`consent-callback.controller.ts:59-80`, explicit comment: "Only
   `'bootstrapped'` logs this action"). `'existing'` produces no audit
   trail, no discovery re-trigger, and no scope-related write of any
   kind.

### A/B/C/D, answered separately as instructed

- **A — Microsoft/Entra supports re-consent.** Confirmed (prior session,
  live Portal evidence).
- **B — our existing `/connect` flow "successfully completes" re-consent.**
  Qualified, not a clean yes: the flow does not error and does land the
  user on `/dashboard` — but only because `resolveOrProvisionFromConsent`
  treats it as an ordinary returning-admin sign-in (`kind: 'existing'`,
  identity-only check), not because anything recognized a re-consent
  event occurred. Calling this "handling" re-consent would overclaim —
  it is a silent no-op with respect to the new scope, not a success path
  for it.
- **C — our application can independently verify the effective
  permissions.** Not confirmed — false. `GraphConsentVerifierService` is
  never invoked on the `existing` branch (step 6 above), and this ADR's
  own 2026-08-13 amendment already ruled out building a
  `Sites.ReadWrite.All`-specific pre-flight probe elsewhere either.
- **D — our application persists/records the permission state.** Not
  confirmed — false. `MicrosoftTenant` (`prisma/schema.prisma:258-283`) is
  never written to on this path; no field exists to record scopes even if
  it were.

### Live evidence collected (2026-08-20, part 2) — step 1-7, via this codebase's own redirect

The tenant admin (same tenant as the Azure Portal test) ran steps 1-7
above for real, through this codebase's actual `/connect` →
`buildAdminConsentUrl()` → Microsoft `/adminconsent` path (not the Portal
button this time). The captured redirect back to
`/connect/admin-consent-callback`:

```
http://localhost:3000/connect/admin-consent-callback?admin_consent=True&tenant=8b07cb96-285a-4122-a1cb-d2b35bdcee64&state=07fd0f29-a214-457a-a67b-56b4f0845298
```

**What this confirms**:
- Exactly the three query parameters predicted in step 3 are present:
  `admin_consent=True`, `tenant=<entra-tenant-guid>`, `state=<opaque
  value>` — no `error`/`error_description`, i.e. a clean success.
- `admin-consent-callback/page.tsx`'s `succeeded` check
  (`adminConsent === 'True' && !error`, line 48) evaluates `true` for
  this real redirect — the "Permission granted" screen renders, exactly
  as predicted, for this exact re-consent-on-an-already-connected-tenant
  scenario, using this codebase's own code path rather than the Portal
  button.
- This independently reconfirms the earlier Portal-button evidence
  (re-consent for an already-connected tenant does update the grant),
  now through the actual mechanism real customers would use — closing
  the "mechanism tested vs. mechanism this product uses" caveat noted in
  the first live-evidence section above.
- Still unconfirmed by this step alone: whether Microsoft's tenant-wide
  grant genuinely now includes `Sites.ReadWrite.All` (this redirect only
  proves the admin-consent *dialog* completed successfully, not which
  scopes were in it — though combined with the manifest change and the
  earlier Portal-checkmark evidence, this is close to fully corroborated,
  not merely assumed). Still not independently confirmed via a direct
  Graph call (see "still requiring" below).
- `admin-consent-callback/page.tsx` still never reads the `tenant` query
  parameter it received here (confirmed again by this real example) —
  the value `8b07cb96-...` is visible in the URL but is not consumed by
  any code in that file.

### Live evidence collected (2026-08-20, part 3) — step 6-7 completed, full trace now observed end to end

Continuing the same live session: the admin clicked "Continue to
sign-in," completed the real Microsoft sign-in, and reached
`/connect/finishing`.

- **`POST /auth/consent-callback` response**: `"kind": "existing"` —
  exactly the predicted resolution (`onboarding.ts:155-162`'s early
  return), not `'bootstrapped'` or `'provisioned-pending'`.
- **UI observed**: "Finishing setup…" then a direct landing on
  `/dashboard` — no "Discovering your SharePoint sites…" message at any
  point. This is itself a precise confirmation, not just a vibe: per
  `finishing/page.tsx:148-151`, the discovery-polling branch (which is
  what would render "Discovering your SharePoint sites…") is only
  entered when `resolution.kind === 'bootstrapped'`. Seeing the plain
  "Finishing setup…" (the default pre-resolution render,
  `finishing/page.tsx:222-226`) and nothing else is consistent with
  `'existing'` skipping that branch entirely, exactly as traced.
- **Audit Log**: checked directly by the admin. One entry was present
  around this time, but it was an unrelated scan-trigger event — **no
  entry for the tenant-connection/re-consent event itself** (no
  `microsoft_tenant.connected` row, or equivalent). This is exactly the
  predicted absence from `consent-callback.controller.ts:59-73`'s
  explicit comment ("Only `'bootstrapped'` logs this action") — `kind:
  'existing'` writes no audit trail, confirmed live rather than only
  read from the comment.

**This closes the source-level trace end to end with live evidence**,
not just code reading, for every step except the direct Graph-level
scope check (still open, see below). Steps 1-7 (the `/adminconsent`
redirect, `admin_consent=True`/`tenant`/`state`) were confirmed in part 2
above; step 6-7 (the backend resolution, UI routing, and audit-log
absence) are confirmed here.

### What remains unverified

- ~~Steps 1-7 (the `/adminconsent` redirect itself) were not literally
  driven through a browser this session.~~ **Done (2026-08-20, part 2).**
- ~~Step 6 (the backend's `resolveOrProvisionFromConsent` resolution,
  UI routing, and audit-log behavior) was not yet captured live.~~
  **Done (2026-08-20, part 3, above)** — `kind: 'existing'`, direct
  `/dashboard` landing with no discovery poll, no audit-log entry: all
  three confirmed live, matching the source trace exactly.
- A secondary path exists and was not traced in as much depth: if the
  browser session belonged to a person **without** an existing `User` row
  for this identity (e.g., a different admin who never signed in before),
  `findUserByEntraIdentity` would return null and the function would
  reach the `candidates.length > 0` / `consented` branch instead,
  producing `kind: 'provisioned-pending'` via `provisionUserFromExisting
  Tenant` (`onboarding.ts:184-195`) — still without any call to
  `GraphConsentVerifierService`. Doesn't change the conclusion (no
  verification either way) but is a distinct code path worth naming
  precisely rather than conflating with step 6 above.
- Direct Graph/token-level confirmation of the effective granted scope
  (independent of the Azure Portal's own UI) — not performed this
  session; would require live network access and this app's real client
  credentials, neither available in this sandbox.

### Can the current `/connect`/`/adminconsent` flow be reused for re-consent?

Not as-is, and not safely as a customer-facing re-consent trigger without
backend changes. It would not error if a customer tried it — but nothing
about the event would be detected, verified, or recorded, which would
create a false impression (for both the customer and this product) that
something meaningful happened when nothing was. Reusing it unmodified
would be worse than building nothing, because it looks like a working
re-consent flow while being a no-op underneath.

### Architectural gap, sharpened

The three gaps named earlier in this ADR are unchanged in substance, but
now have an exact mechanism, not just a description:

- The `existing` early-return in `resolveOrProvisionFromConsent`
  (`onboarding.ts:154-162`) is the *specific* code location that would
  need a new branch to ever recognize "this identity already exists, but
  a re-consent may have just happened" as distinct from "an ordinary
  returning sign-in."
- `ConsentCallbackRequest` (`consent-callback.dto.ts:8-11`) would need to
  carry something from Microsoft's actual redirect (at minimum
  `admin_consent`/`tenant`) if the backend is ever meant to know a
  re-consent redirect occurred at all — today it structurally cannot,
  since that DTO never receives those values.
- `MicrosoftTenant` still has nowhere to record a scope/permission state,
  as already established.

### Recommended next step

1. ~~Have the same tenant admin literally click through `/connect` →
   `/adminconsent` → sign-in → `/connect/finishing` once, in a browser,
   and report what screen/state results and the literal query string
   `/connect/admin-consent-callback` receives.~~ **Done (2026-08-20,
   parts 2-3, above)** — fully observed live: the redirect
   (`admin_consent=True&tenant=...&state=...`), the backend resolution
   (`kind: 'existing'`), the UI routing (straight to `/dashboard`, no
   discovery poll), and the audit log (no entry for this event) all
   matched the source-level trace exactly. This codebase's own
   `/connect`/`/adminconsent` flow is now confirmed, with live evidence
   rather than inference, to be a functional no-op for an
   already-connected admin's re-consent — it doesn't fail, but it
   doesn't detect, verify, or record the new scope either.
2. **Still open**: obtain an app-only token via this app's own
   client-credentials grant and make one direct Graph call to confirm
   `Sites.ReadWrite.All` is genuinely present for this tenant at the
   token/API level, independent of the Azure Portal UI's checkmark. This
   is the one piece of the original investigation not yet closed —
   everything about *this codebase's* behavior is now fully observed;
   what remains is independent confirmation of *Microsoft's* resulting
   grant, belt-and-suspenders rather than load-bearing for the
   conclusions above.
3. Now that B/C/D are conclusively answered (§"A/B/C/D, answered
   separately as instructed" above) with live confirmation, not just
   code reading, the "Deliberately deferred" design decisions (an
   explicit re-consent-detection branch, what `ConsentCallbackRequest`
   should carry, `NeedsReconsent` vs. an alternative, where granted
   scopes get recorded, whether a dedicated reconnect endpoint is the
   right shape) are ready to be made — but still not decided by this
   investigation itself; that is deliberately the next, separate
   conversation.
