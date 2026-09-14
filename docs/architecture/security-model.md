# Security Model

Describes the authentication, authorization, and tenant-isolation model as
implemented today, plus what Phase 9's security review found and fixed.
See ADR-0001 (multi-tenancy), ADR-0003 (Graph permissions), ADR-0010/0011
(identity/auth trust model), ADR-0012 (onboarding).

## Authentication

- Microsoft Entra ID, **multi-tenant** app registration — each customer
  authenticates against their own Azure AD tenant, never a shared one.
- `apps/web` acquires an **ID token** via MSAL and sends it as
  `Authorization: Bearer <token>` — this is bearer-token auth, not
  cookie/session auth, which is the reason CORS is a lower-severity
  concern here than it would be for a cookie-authenticated API (there's no
  CSRF angle), though it's still hardened (see below).
- `apps/api`'s `EntraJwtGuard` (`apps/api/src/auth/entra-jwt.guard.ts`)
  verifies every request's token: signature via `jose`'s
  `createRemoteJWKSet` against Microsoft's `/organizations/discovery/v2.0/keys`
  endpoint (work/school accounts only — not `/common`, which would also
  accept personal Microsoft accounts, not this product's account model),
  `aud` pinned to this app's `ENTRA_CLIENT_ID`, algorithm pinned to
  `RS256`.
- **Multi-tenant issuer reconciliation**: a multi-tenant app can't check
  `iss` against one fixed string (the library's `issuer` option only
  accepts a static value), so `iss` is instead manually checked against
  the token's own `tid` claim
  (`https://login.microsoftonline.com/{tid}/v2.0`) — this is Microsoft's
  documented validation algorithm for multi-tenant resource servers, not
  an approximation.
- `tid` is additionally checked against a GUID pattern before use.

## Authorization

- **Identity resolution** (`TenantContextGuard`) turns verified Entra
  claims (`tid`+`oid`) into an application `User`, using the *compound*
  key Microsoft's own guidance requires (`oid` is only unique **within**
  the issuing tenant — `tid`+`oid` together is the correct identity key,
  never `oid` alone; ADR-0010).
- A user's very first authenticated request auto-provisions a
  `PendingApproval` user **only** if their tenant already has a
  `Consented` `MicrosoftTenant` — an unrecognized `tid` with no connected
  tenant is rejected outright. Bootstrapping a brand-new `Organization`
  only happens through the dedicated admin-consent callback endpoint,
  never this path — this deliberately narrower behavior prevents an
  arbitrary Entra tenant from silently creating itself an `Organization`
  by just calling a regular API route.
- `user.status !== 'Active'` (i.e. still `PendingApproval`) is rejected —
  authenticated is not the same as authorized.
- **Role-based access** (`RolesGuard` + `@Roles(...)`) — checked only on
  routes that declare required roles; a route without `@Roles()` is a
  no-op pass-through for this guard (authorization for those routes is
  "any active user in the org," enforced by the guards above it).
- **IDOR prevention** (`OrganizationAccessGuard`) — every route is scoped
  under `/organizations/:id/...`; this guard rejects any request where
  `:id` doesn't match the authenticated user's own `organizationId`.
  `organizationId` for actual data access is **always** derived from
  `req.user`, never from the route param directly — this guard exists to
  reject a mismatched param early, not to establish scoping itself.

Guard order (`EntraJwtGuard` → `TenantContextGuard` → `OrganizationAccessGuard`
→ per-route `RolesGuard`) is load-bearing: each guard depends on
request state the previous one sets. See `request-flow.md` for the full
walkthrough.

## Tenant isolation

- Every tenant-scoped table carries `organizationId` (ADR-0001).
  `createTenantContext(organizationId)` (`packages/database`) is the
  **only** sanctioned way application code reads/writes this data — it
  returns a repository set that has no unscoped query method to call by
  accident.
- Exactly **two** sanctioned exceptions exist in the entire codebase, both
  narrowly scoped and documented in place, because both run *before* an
  `organizationId` can possibly be known:
  1. `findUserByEntraIdentity` (`packages/database/src/identity.ts`) —
     resolves a user during auth, before `TenantContextGuard` has
     established which organization the request belongs to.
  2. `findDueScanSchedules` (`packages/database/src/scheduler.ts`) — the
     scheduler tick's "which schedules are due, across every org" query;
     inherently cross-tenant since it's what *produces* the
     `organizationId`s to then scope per-schedule work under.
- The Microsoft-tenant-to-organization relationship is purely an
  auth/consent mechanism (which Entra tenant is allowed to authenticate as
  this organization) — it has no bearing on data isolation, which is
  enforced entirely at the application/database layer via
  `organizationId`, independent of which Entra tenant is asking.

## Least-privilege external access

- Microsoft Graph: **application (app-only)** permissions, granted via
  tenant-admin consent at onboarding (ADR-0003 + 2026-09-12 amendment):
  `Files.Read.All`, `Sites.Read.All` (read/scanning) and
  **`Sites.ReadWrite.All`** (required for review-date write-back — ADR-0022;
  permission version 2). Write-back is the app's single SharePoint write
  action (setting a document's mapped review-date column via
  `PATCH .../listItem/fields`); it is gated off (API-authoritative
  `403`, plus a proactive UI notice) for any tenant that has not re-consented
  to the write scope. **`Files.ReadWrite.All` is deliberately NOT requested** —
  write-back never touches file content, only list-item field values, so the
  file-write scope would violate least privilege for zero functional benefit.
- Scan scope is further narrowed at the application layer: only
  `SharePointSite`s an Admin has explicitly set to `Approved` are ever
  enumerated (ADR-0014) — the Graph permission grants tenant-wide read
  access, but the product never uses more of it than an admin has opted
  into.
- Document **content** is never downloaded — only metadata (name, size,
  timestamps, owner, mime type). No document body ever leaves SharePoint.

## CORS (Phase 9)

Previously `app.enableCors()` with no options — Express/Nest reflects back
whatever `Origin` header a request sends, which is effectively allow-all.
Since this API is bearer-token authenticated (not cookie-based), this
wasn't a CSRF hole, but it was still the only thing standing between "a
script on an arbitrary site holding a stolen/leaked token" and reading this
API's JSON responses back in-browser. Fixed: CORS now restricted to
`WEB_APP_ORIGIN` (comma-separated, supports e.g. a staging + prod
frontend), defaulting to `http://localhost:3000` for zero-config local dev
(`apps/api/src/main.ts`).

## Secrets handling

- No secret is ever logged. Verified across `apps/api`/`apps/worker`: no
  stray `console.log`, and the Phase 9 request-logger middleware logs only
  method/path/status/duration/request-ID — never headers or body (tested
  explicitly in `request-logger.middleware.spec.ts`).
- `ENTRA_CLIENT_SECRET` and connection strings are sourced from Azure Key
  Vault in production (ADR-0006), injected as container env vars — never
  present in an image layer.
- MSAL tokens on the frontend use MSAL's own storage (session-scoped by
  configuration), not a custom `localStorage` implementation.

## Input validation

Manual, per-controller validation (no `class-validator`/`class-transformer`
pipe globally installed) — e.g. `documents.controller.ts`'s query-param
parsing, `scan-schedule.controller.ts`'s `frequency` enum check. This is a
deliberate, established convention throughout the codebase, not an
oversight — each controller validates the specific shape it accepts,
consistent with this repo's preference for explicit code over declarative
decorators/pipes for validation.

## Error handling

No custom global exception filter exists — NestJS's built-in default
exception filter already returns a generic `500` body with no stack trace
for unhandled errors, and every guard/service in this codebase throws
NestJS's typed HTTP exceptions (`UnauthorizedException`,
`ForbiddenException`, etc.) for expected failure cases, which Nest
serializes safely by default. Reviewed and confirmed adequate — adding a
filter was considered and deliberately not done, since it wouldn't change
any actual behavior today.

## Known residual risks (accepted for this phase)

- **No rate limiting / request throttling** on `apps/api`. Recommended for
  a future phase; out of scope here as a new capability rather than a
  hardening fix to an existing one.
- **No `helmet`** (security response headers). Recommended, not applied —
  lower-impact for a JSON/bearer-token API than for a cookie-authenticated,
  HTML-serving one, but still a reasonable low-cost addition later.
- **No automated dependency vulnerability scanning** configured in CI.
- **`GovernanceActivity`/`AuditLog` append-only enforcement is
  application-layer only, not database-layer.** See the plan below —
  deliberately not implemented yet, because doing so today would be
  unverifiable in this environment (see "why not now").

## Planned: database-level write immutability for GovernanceActivity/AuditLog

**Current state.** `GovernanceActivityRepository` and `AuditLogRepository`
(`packages/database/src/repositories/`) are append-only by construction —
each class's public surface exposes only `findMany`/`findFirstById`/`count`/
`create`; there is no `updateById`/`deleteById` method to call, by design
(ADR-0016, ADR-0019). This is real protection against every code path that
goes through `createTenantContext()`, which is the sanctioned way
application code touches the database (see "Tenant isolation" above) — but
it is enforced by TypeScript's type system and code-review discipline, not
by Postgres itself. Anything with a raw `PrismaClient`/`$queryRaw`, or a
future migration/admin script, could still `UPDATE`/`DELETE` these rows.
Database-level enforcement (`REVOKE UPDATE, DELETE`) would close that gap
as defense-in-depth, independent of the application code being correct.

**Why not implemented now.** Every environment this codebase currently
runs in — local dev (`docker-compose.yml`: `POSTGRES_USER: postgres`) and
CI (`.github/workflows/ci.yml`: `postgresql://postgres:postgres@...`) —
connects as the Postgres **superuser**. `REVOKE` has no effect on a
superuser (superusers bypass all privilege checks), so a `REVOKE` migration
written today would be a silent no-op in both places it could be tested,
and genuinely unverifiable. Production's actual runtime connection role is
unknown from this codebase — `DATABASE_URL` is injected from Azure Key
Vault at deploy time (ADR-0006) and is not visible here. Writing a
migration that assumes a specific non-superuser role name without being
able to confirm it exists risks either a no-op (if the role doesn't
exist/isn't used) or, if a migration step tries to `GRANT`/`ALTER` a
role that turns out not to match production's real setup, a failed
deploy. Per instruction, this is a plan to hand to whoever owns the
production database provisioning, not a guess encoded into a migration.

**Plan, once a non-superuser application role exists:**

1. **Provision two distinct Postgres roles**, if they don't already exist
   in the target environment:
   - A **migration role** (e.g. `sph_migrator`) — owns the schema, runs
     `prisma migrate deploy`, has full DDL/DML privileges. This is the
     role CI/CD's deploy step connects as.
   - A **runtime role** (e.g. `sph_app`) — the role `apps/api` and
     `apps/worker` actually connect as in production. Only needs the DML
     privileges those apps genuinely use (`SELECT`/`INSERT`/`UPDATE`/
     `DELETE` on ordinary tables; `SELECT`/`INSERT` only on
     `GovernanceActivity`/`AuditLog`).
   - This mirrors a standard Postgres least-privilege pattern and is a
     bigger change than just this one hardening fix — it also means two
     separate connection strings need to exist in Key Vault
     (`MIGRATION_DATABASE_URL`, `DATABASE_URL`), which is an infra/ops
     decision, not something this codebase can self-provision.
2. **Add a migration** (via `prisma migrate dev --create-only`, then
   hand-edit — Prisma's schema DSL has no `REVOKE` primitive, so this has
   to be raw SQL in the generated migration file, same as any other
   Postgres feature Prisma doesn't model natively):
   ```sql
   REVOKE UPDATE, DELETE ON "GovernanceActivity" FROM sph_app;
   REVOKE UPDATE, DELETE ON "AuditLog" FROM sph_app;
   ```
   (Exact role name TBD by whoever provisions it — `sph_app` above is a
   placeholder, not a decision made here.)
3. **Point `apps/api`/`apps/worker`'s runtime `DATABASE_URL` at the
   restricted role**, keeping the migration role only for the deploy
   step. Both apps already only ever call `create`/`findMany`/
   `findFirstById`/`count` against these two tables (verified above), so
   this change should be invisible at the application layer if done
   correctly.
4. **Verify in an environment where the runtime role is genuinely
   non-superuser** — this cannot be verified in the current local dev or
   CI setup (both are the superuser). A staging environment, or a local
   docker-compose addition that provisions a second, restricted role via
   Postgres's init-script mechanism, would be the place to prove
   `UPDATE`/`DELETE` against these two tables actually fails with the
   restricted role, while every existing repository method still works.
