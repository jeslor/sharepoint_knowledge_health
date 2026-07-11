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
