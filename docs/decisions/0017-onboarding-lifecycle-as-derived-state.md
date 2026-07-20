# ADR-0017: Onboarding Lifecycle as Derived State

Date: 2026-07-20
Status: Accepted

---

## Problem

ADR-0012 defines how an `Organization`/`MicrosoftTenant`/first `User` get bootstrapped from admin consent, and Phase 6 (ADR-0012's own amendment) built the frontend flow that reaches that bootstrap endpoint. Neither decides how a customer's *progress through the rest of onboarding* — site discovery, site approval, schedule configuration, first scan — is represented, tracked, or resumed. Today this is implicit: three disconnected full-page transitions (`/connect` → `/connect/admin-consent-callback` → `/connect/finishing`) hand off to the ordinary dashboard shell with no persistent notion of "how far along is this organization." A design review this session (informal, product/UX-focused, preserved in `.claude`-adjacent planning notes, not itself an ADR) identified this as a real gap before building an onboarding checklist/progress UI, and this ADR is the architectural decision that review converged on.

## Context

- `MicrosoftTenant.status` (`PendingConsent | Consented | Revoked`), `SharePointSite.status` (`Discovered | Approved | Removed`), `ScanSchedule` (one row per organization once configured), and `ScanJob.status` (`Queued | Running | Completed | Failed | Cancelled`) already exist and are each independently the authoritative record of their own concern.
- Every one of these facts is already written by an existing, working code path (admin-consent bootstrap, discovery, approval endpoints, schedule CRUD, scan triggering) — nothing here needs a new *write* path to produce the underlying data.
- The frontend has no single place today that reads all of these together to answer "what should this organization's admin do next."

## Decision

**Onboarding progress is never stored as its own field, column, or model. It is computed, on every read, from the existing domain entities listed above.**

### 1. No persisted onboarding step

There is no `Organization.onboardingStep`, no `OnboardingProgress` table, no client-held "current step" beyond ordinary React state for the current page render. The reason is deliberate, not an oversight: a stored step is a second source of truth that can desync from what actually happened (e.g., a step field says "pending approval" after an admin already approved every site through some other path, or after a second Admin acts while the first Admin's browser tab still shows stale state) — exactly the class of bug this ADR exists to prevent, and consistent with this project's established preference (ADR-0015 §1's scheduler tick, `HealthSnapshot`'s "no recalculation" invariant) for deriving state from durable facts rather than tracking a parallel progress flag.

### 2. Status computed from existing domain entities

A new endpoint, `GET /organizations/:id/onboarding-status`, computes and returns:

```typescript
interface OnboardingStatusResponse {
  microsoftConnection: 'PendingConsent' | 'Consented' | 'Revoked';
  discovery: {
    status: 'NotStarted' | 'Queued' | 'Running' | 'Completed' | 'Failed';
    discoveredSitesCount: number;
  };
  sitesApproved: boolean;     // any SharePointSite row has status: Approved
  scheduleConfigured: boolean; // a ScanSchedule row exists for the org
  firstScanCompleted: boolean; // any ScanJob for the org has status: Completed
}
```

Each field is a direct, cheap read against an existing table (`findFirst`/`count`-shaped queries, no joins across concerns beyond what `TenantContext` already scopes) — no new aggregation logic, no caching layer, matching this project's "avoid over-engineering" principle and the same "derive, don't duplicate" precedent `HealthSummaryService` already established for the dashboard's health aggregate.

**Discovery is the one field in this response that is not a pure derived read, and that distinction is deliberate, not a contradiction of §1.** A boolean (`sitesDiscovered`) cannot express the five real states a queued worker job passes through — not started, queued, actively running, completed (possibly with zero sites — a legitimate outcome, not an error), or failed and needing attention — and forcing the frontend to guess at "in progress vs. stuck" from an incomplete signal is exactly the anti-pattern this ADR exists to prevent. `discovery.status` is backed by a small set of fields on `MicrosoftTenant` (`discoveryStatus`, `discoveryStartedAt`, `discoveryCompletedAt`, `discoveryError` — introduced by ADR-0014's companion amendment, not this ADR) that record the state of the *current discovery job*, the same way `ScanJob.status` already records the state of a scan job. **This is not the "persisted onboarding step" §1 rules out** — it is a persisted fact about one specific async operation in flight, exactly analogous to `ScanJob.status`, which nobody would characterize as a stored wizard-step flag either. The onboarding *checklist position* itself (which of these five response fields the UI is currently drawing attention to) remains 100% derived and un-stored; only the discovery job's own lifecycle — an operation that genuinely has an in-flight state a pure table-count can't represent — gets a small, scoped, single-current-value signal. `discoveredSitesCount` itself stays a pure derived count (`SharePointSite` rows for the tenant), with no separate storage.

### 3. Frontend renders backend truth only

The onboarding UI (a checklist/progress view, not a linear wizard with its own step state) fetches `onboarding-status` and renders exactly what it says — no client-side inference, no "I remember which step I was on" logic surviving a refresh. This is what makes the journey correctly survive:

- An OAuth redirect to Microsoft's own domain and back (nothing client-held to lose).
- A browser refresh or a tab closed and reopened later.
- A second Admin joining and continuing setup from a different browser/session entirely.
- Any action taken through a path *other* than the onboarding UI itself (e.g., an Admin approves a site from `/dashboard/sharepoint` directly instead of an onboarding step) — the derived status reflects it immediately, because it's reading the same underlying tables.

### 4. Trust/scope explanation screen

Before the `/connect` redirect to Microsoft's admin-consent endpoint, a new static (no backend dependency) screen states plainly what is requested (`Files.Read.All`/`Sites.Read.All`, per ADR-0003) and what is never done (no writes, no deletes, no email access) — a product-trust/AppSource-readiness improvement identified in this session's review, not a new architectural surface; purely presentational, uses only existing design-system primitives.

## Acceptance Criteria

- `GET /organizations/:id/onboarding-status` returns correct values for every combination of underlying state, independent of how that state was reached (onboarding UI, direct admin action, or a mix) — tested by seeding each table combination directly and asserting the response, not by driving the onboarding UI itself.
- This ADR itself introduces no schema — the small `discoveryStatus`/`discoveryStartedAt`/`discoveryCompletedAt`/`discoveryError` addition to `MicrosoftTenant` that `discovery.status` reads belongs to ADR-0014's companion amendment (alongside `MicrosoftTenant.revokedAt` from ADR-0012's amendment and ADR-0019's audit log) — tracked there, not duplicated here.
- The onboarding UI, given only this endpoint's response, can render a correct checklist after: a fresh page load, a hard refresh mid-flow, and a second browser session for a different Admin on the same organization.

## Tradeoffs

- Every onboarding-status read re-queries several tables rather than reading one flag — an acceptable cost given the endpoint is only called on onboarding-adjacent pages (low, human-paced request volume), not a hot path.
- Callers must handle a "discovery in progress, not yet reported" intermediate state explicitly (see ADR-0014's amendment) rather than a simple boolean — slightly more UI-state handling in exchange for correctness across a genuinely async operation.

## Future Considerations

- If onboarding grows enough distinct steps that recomputing all of them on every read becomes measurably expensive, a read-through cache keyed by `organizationId` with short TTL is the natural next step — not a stored progress flag, which would reintroduce the exact desync risk this ADR avoids.
- The same derived-status approach should be reused for any future "setup checklist"-shaped feature (e.g., a second Microsoft tenant's own connection progress), rather than each one inventing its own tracking field.
