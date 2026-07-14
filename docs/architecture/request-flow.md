# Request Flow

Two concrete walkthroughs of a real request through the current
implementation: an authenticated read, and a scan trigger (which crosses
into the queue — see `worker-pipeline.md` for what happens after that).

## 1. An authenticated API request

Example: `GET /organizations/:id/scans` from the dashboard.

1. **`apps/web`** acquires an Entra ID token via MSAL (browser), attaches it
   as `Authorization: Bearer <token>`, calls `apps/api`.

2. **`RequestLoggerMiddleware`** (`apps/api/src/common/request-logger.middleware.ts`,
   applied globally in `app.module.ts` via `NestModule.configure()`, i.e.
   before any guard) — reads `x-request-id` if the caller/upstream proxy
   supplied one, otherwise mints one (`crypto.randomUUID()`). Sets
   `req.requestId`, echoes it back as a response header, and logs
   `METHOD path status durationMs [requestId]` once the response finishes.
   Runs for every route, including `/health`.

3. **`EntraJwtGuard`** (`apps/api/src/auth/entra-jwt.guard.ts`) — verifies the
   bearer token: signature against Microsoft's JWKS endpoint (`jose`,
   cached `createRemoteJWKSet`), `aud` = this app's `ENTRA_CLIENT_ID`,
   `alg` pinned to `RS256`. Because this is a *multi-tenant* app
   registration, there is no single fixed issuer string to check against a
   library option — `iss` is manually reconciled against the token's own
   `tid` claim (`https://login.microsoftonline.com/{tid}/v2.0`) instead,
   following Microsoft's documented algorithm for multi-tenant resource
   servers. Sets `req.entraClaims = { tid, oid, email, name }`. Throws
   `401` on any failure — missing header, bad signature, wrong audience,
   missing/malformed `tid`/`oid`, issuer mismatch.

4. **`TenantContextGuard`** (`apps/api/src/auth/tenant-context.guard.ts`) —
   resolves `req.entraClaims` to an application `User`:
   - `findUserByEntraIdentity(tid, oid)` — the codebase's one sanctioned
     unscoped lookup (no `organizationId` exists yet at this point;
     documented in `packages/database/src/identity.ts`).
   - If no user exists yet: looks up `MicrosoftTenant`s for that `tid`,
     requires one already in `Consented` status, and provisions a new
     `PendingApproval` user under it (ADR-0012). An unrecognized `tid` with
     no consented tenant is rejected (`403`) — bootstrapping a *new*
     `Organization` only happens through the dedicated admin-consent
     callback endpoint, never this path.
   - Requires `user.status === 'Active'` (`403` otherwise —
     `PendingApproval` users are authenticated but not yet authorized).
   - Sets `req.user` and `req.tenantContext = createTenantContext(user.organizationId)`.

5. **`OrganizationAccessGuard`** (`apps/api/src/common/organization-access.guard.ts`)
   — compares the route's `:id` param against `req.user.organizationId`.
   `organizationId` is *never* taken from client input for scoping
   purposes; this guard only exists to reject a mismatched `:id` early
   (`403`) as an IDOR guard, before the controller runs.

6. **`RolesGuard`** (`apps/api/src/auth/roles.guard.ts`, mutation endpoints
   only, via `@UseGuards(RolesGuard)` + `@Roles(...)` on the specific
   handler) — checks `req.user.role` against the roles the route declares.

7. **Controller → Service → `req.tenantContext`** — every data access goes
   through the tenant-scoped repository set returned by
   `createTenantContext()` (`packages/database`), which prefixes every
   query with the resolved `organizationId`. There is no code path in a
   controller/service that can query another organization's rows by
   accident, because the repositories don't expose an unscoped method.

8. Response returned; middleware's `res.on('finish', ...)` logs the
   completed request with its request ID.

Guard order is fixed by `@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)`
at the controller level (e.g. `apps/api/src/scans/scans.controller.ts`) and
is load-bearing: `TenantContextGuard` reads `req.entraClaims`, which only
exists if `EntraJwtGuard` ran first; `OrganizationAccessGuard` reads
`req.user`, which only exists if `TenantContextGuard` ran first. NestJS
guards run in array order, so this is enforced by the decorator, not
convention alone — but reordering the array would silently break it (no
compile-time check ties the order to the data dependency).

## 2. Triggering a scan

`POST /organizations/:id/scans` (or the scheduler tick — see
`worker-pipeline.md`):

1. Same guard chain as above.
2. `ScansService.triggerScanForOrganization` (`apps/api/src/scans/scans.service.ts`)
   resolves the organization's single `Consented` `MicrosoftTenant`
   (`404` if none, `409` if more than one — ambiguous which tenant to
   scan).
3. Checks for an in-flight scan (`Queued`/`Running` `ScanJob` for that
   tenant) — returns the existing job rather than creating a duplicate.
4. Creates a `ScanJob` row (`status: Queued`, `triggerSource: Manual`,
   `triggeredByUserId` = the requesting user).
5. `scanQueue.add('scan', { organizationId, scanJobId })` onto
   `SCAN_QUEUE` (BullMQ/Redis), with `attempts: 3` + exponential backoff
   and bounded retention (`removeOnComplete`/`removeOnFail`, Phase 9).
6. Returns the `ScanJob` immediately (`202`-style semantics via `201`) —
   the API never blocks on the scan itself. `apps/worker` picks the job up
   independently; see `worker-pipeline.md` for everything after this point.
