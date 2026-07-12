# Phase 6 Completion Notes — Health Insights Dashboard

Date: 2026-07-12
Status: Complete — full monorepo verification green (32/32 turbo tasks, 183 tests)

## Scope delivered

Exposes the Phase 5 scoring pipeline through an authenticated SaaS
dashboard. Two halves, built in dependency order: (1) the frontend auth
layer that didn't exist before this phase, and (2) the dashboard itself.

### 1. Frontend authentication (client-side completion of ADR-0011)

`apps/web` had zero auth wiring before this phase. Added `@azure/msal-browser`
+ `@azure/msal-react`: `loginRedirect`/`logoutRedirect`, an `AuthGate`
component gating `/dashboard/*`, and a token-acquisition hook
(`useAccessToken`) that acquires silently and falls back to an interactive
redirect only when required. Sends the ID token (not an access token) as
the Bearer credential — confirmed by reading `entra-jwt.guard.ts` directly
rather than assuming, since `EntraJwtGuard` validates an ID-token-shaped
`aud` claim. `sessionStorage` cache (MSAL's own recommended default), never
`localStorage`. No backend guard or trust-model change — see ADR-0011's
2026-07-12 amendment.

### 2. Typed API client + `packages/types` correction

ADR-0009 always said API request/response DTOs belong in `packages/types`;
Phase 5 didn't follow that (they lived in `apps/api/src/documents/dto.ts`).
Since this phase is the first time `apps/web` needed any of them, moved
them into `packages/types/src/api/*.ts` now rather than duplicating —
`apps/api` and `apps/web` share one definition. See ADR-0009's
implementation note.

`apps/web/src/lib/api/`: a plain `fetch` wrapper (`client.ts`), typed
per-endpoint functions (`endpoints.ts`), and one shared data-fetching hook
(`use-api-query.ts`) — deliberately not a data-fetching library (SWR/React
Query), per this phase's own "avoid unnecessary dependencies" constraint.
Handles the loading/error/empty-state requirement and guards against the
race a hand-rolled `useEffect` fetch is prone to (a stale response
overwriting fresher state when filters change quickly).

### 3. Backend API extensions

- `GET /organizations/:id/health-summary` — new. Total scanned documents,
  average score, critical/warning issue counts (from *current* health
  scores only), last successful scan time, current scan status.
- `GET /organizations/:id/document-health` — extended in place (not a new
  endpoint, per "prefer extending existing contracts"). Added pagination,
  sorting (score/name/lastModified), and filtering (severity/site/score
  range) — all pushed to the database via `Document`'s real
  `currentHealthScore` Prisma relation, not computed in memory. Added
  `siteId`/`siteName`/`owner`/`status`/`lastModifiedAt`/`issueCount` to the
  response. Response shape changed from a bare array to a paginated
  envelope (`{ data, pagination }`) — the one shape-breaking change in this
  phase, safe because this endpoint had zero real consumers before Phase 6.
- `GET /organizations/:id/documents/:documentId` — new. Full metadata +
  current score + issues for one document.
- `GET /organizations/:id/scans` — new. Most recent 50 scans, newest first.
- `POST /organizations/:id/scans` — new convenience route. Auto-resolves
  the org's single `Consented` `MicrosoftTenant` (404 if none, 409 if
  ambiguous with more than one); delegates to the *same*
  `ScansService.triggerScan` from Phase 5 (same concurrency guard) rather
  than duplicating logic. The existing
  `POST .../microsoft-tenants/:tenantId/scans` route is untouched.
- `GET /organizations/:id/scans/:scanId` — unchanged.

Every controller carries the same `EntraJwtGuard, TenantContextGuard,
OrganizationAccessGuard` chain as the Phase 5 controllers — confirmed, not
assumed, by grepping every new/extended controller file directly.

### 4. Dashboard UI (`apps/web/src/app/dashboard/`)

- `/dashboard` — organization overview (6 required stats).
- `/dashboard/documents` — health table (name/site/owner/score/status/
  modified/issue count), sortable by score, filterable by severity/site/
  score range, paginated. Filter/sort/page state lives in the URL (shareable,
  survives refresh), not component state.
- `/dashboard/documents/[documentId]` — metadata + score + issues, each
  issue showing its real severity (`RequiresReview`/`NeedsAttention`,
  displayed as "Critical"/"Warning" — the actual 2-value enum from
  ADR-0002, not the task brief's illustrative HIGH/MEDIUM/LOW, which
  doesn't match this backend).
- `/dashboard/scans` — scan history + "Start scan" button (disabled while
  one's already in flight, mirroring the backend's own 409 guard). Polls
  every 5s only while a scan is `Queued`/`Running`, stops once terminal.

Tailwind throughout — the only UI pattern that actually exists in this
codebase (`tech-stack.md` mentions Material UI, but it was never installed
or used in real code).

## Testing

- **API**: 78 tests (up from 45 at end of Phase 5) — new
  `health-summary.service.spec.ts`/`.controller.spec.ts`, extended
  `documents.service.spec.ts`/`.controller.spec.ts` (pagination/sort/filter
  param handling, `getDocument` org-isolation), extended
  `scans.service.spec.ts`/`.controller.spec.ts` (tenant auto-resolution,
  409/404 cases). Every new/extended service test includes an
  org-isolation case (a resource belonging to a different `organizationId`
  never resolves).
- **Frontend**: 20 tests (up from 1) — `AuthGate` (authenticated vs.
  unauthenticated rendering, MSAL mocked), `OverviewCards` (all 6 stats,
  empty-state placeholders), `DocumentHealthTable` (rows, empty state,
  sort-header interaction), `ScanList` (all 5 real status values render,
  not invented ones), `TriggerScanButton` (disabled while in flight or
  already active, error rendering).
- Full suite: 183 tests, 32/32 turbo tasks green
  (`pnpm exec turbo run lint typecheck test build`).

## Verification performed

1. `pnpm exec turbo run lint typecheck test build` — 32/32 green.
2. Real boot of the compiled `apps/api`: all 5 new/changed routes mapped
   correctly in the Nest startup log; every one correctly returns 401
   without a Bearer token (confirmed with `curl`, not assumed).
3. Real boot of `apps/web` (`next start`): `/`, `/dashboard`,
   `/dashboard/documents`, `/dashboard/scans` all return 200.
4. `apps/web/eslint.config.mjs` extended to also ban `@sph/graph-client`
   and `bullmq` imports (previously only `@sph/database` was banned) —
   confirms the full ADR-0009 boundary, not just the part Phase 5 needed.

## Known limitation — flagging explicitly

**End-to-end MSAL login was not visually verified in a real browser.**
This sandboxed environment has no real Entra app registration or headless
browser tool available. What *was* verified: the `AuthGate` component's
authenticated/unauthenticated rendering logic (unit-tested with MSAL
mocked), and that every dashboard route boots and returns 200 with the
auth-gated shell. The actual "click Sign in → Microsoft redirect → land
back authenticated" flow needs manual verification against a real Entra
app registration before this ships — this is expected and normal for an
OAuth flow that fundamentally requires a real identity provider, not a
gap introduced by rushing the implementation.

## Correction (2026-07-12): MSAL React integration bug found and fixed

A post-completion review against `@azure/msal-react`'s actual source
(`node_modules/@azure/msal-react/dist/MsalProvider.js`) found a real bug in
the original implementation: `AppProviders` manually called
`msalInstance.initialize()` and `handleRedirectPromise()`, gating
`<MsalProvider>`'s render on that completing. But `MsalProvider` already
calls both internally, in its own `useEffect`, and drives the `inProgress`
state machine (`Startup → HandleRedirect → None`) that
`<AuthenticatedTemplate>`/`<UnauthenticatedTemplate>` already depend on
(confirmed by reading `UnauthenticatedTemplate.js` — it explicitly checks
`inProgress` before rendering, precisely to avoid flashing the wrong auth
state during redirect processing). The original code was calling
`initialize()`/`handleRedirectPromise()` twice — once manually, once by
`MsalProvider` — and consuming the single-use redirect response before
`MsalProvider`'s own event listener was even registered, which could cause
a completed login to never reach `MsalProvider`'s state.

Fixed: removed the manual pre-initialization entirely. `MsalProvider` now
renders immediately and unconditionally; `msal-instance.ts` only
constructs the singleton and registers a `LOGIN_SUCCESS` event callback
(safe to do before `initialize()` resolves — confirmed via
`UnknownOperatingContextController`, msal-browser's pre-initialize stub
controller, which returns `[]`/`null` rather than throwing). Also fixed
`redirectUri`'s default from a bare relative `/` to `window.location.origin`
(a single, fixed, absolute value — msal-browser's own default is the
*current page's full URL*, which would require registering every dashboard
route individually in the Entra App Registration).

Separately, confirmed the reported `AADSTS700038` error is **not a code
bug** — it's Microsoft's own login page rejecting the placeholder all-zeros
`NEXT_PUBLIC_ENTRA_CLIENT_ID`. A real Entra App Registration (multi-tenant,
"Single-page application" platform, Redirect URI = the app's origin) is
required before login can succeed; this is external configuration this
phase's implementation cannot supply on its own.

## Carried-forward limitations (from Phase 5, still true)

`hasReviewDate` is always `false` (no SharePoint custom-column signal
yet — every document reports a ReviewStatus issue); no recursive folder
traversal in the collector; duplicate detection is exact-match only. See
`docs/phases/phase-5-completion.md` for the full list and reasoning.
