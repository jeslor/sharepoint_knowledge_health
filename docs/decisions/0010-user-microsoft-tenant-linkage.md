# ADR-0010: Link User to Its Home MicrosoftTenant

Date: 2026-07-11
Status: Accepted (migration applied, packages/database/src/identity.ts updated to findUserByEntraIdentity(entraTenantId, entraObjectId))

---

## Problem

A pre-authentication review of the `User`, `Organization`, and `MicrosoftTenant` models (requested before implementing auth) found that the schema fully supports multi-org SaaS, one-org-to-many-Entra-tenants, and multi-user orgs — but does not correctly support Entra ID authentication once an `Organization` has more than one connected `MicrosoftTenant`. Three concrete gaps, the third found during review of this ADR itself:

1. `User` has no column recording which of the organization's connected `MicrosoftTenant`s its identity is anchored to, so there is nothing to validate an incoming token's `tid` (tenant ID) claim against on every login after the first.
2. `MicrosoftTenant.entraTenantId` only exists inside the compound `@@unique([organizationId, entraTenantId])` index, which Postgres cannot use to look up by `entraTenantId` alone — but that exact lookup ("which Organization does this brand-new token's `tid` belong to?") is required during first-login provisioning, before `organizationId` is known.
3. **`User.entraObjectId @unique` (globally unique) is incorrect.** Microsoft's identity platform documentation is explicit: the `oid` claim is unique for a given identity *within a single Azure AD tenant*, not across tenants — a person who exists in two different Azure AD tenants gets a *different* `oid` in each. More importantly, Microsoft's own documented guidance for multi-tenant applications warns that `oid` alone must **not** be treated as a globally unique key even within one tenant's worth of history (tenant-deletion/object-ID-reuse edge cases exist) — the documented recommendation is to always use the **combination of `oid` + `tid`** as the unique identifying key. A global `@@unique([entraObjectId])` on `User` doesn't match this guidance and is a correctness bug, not just a missing feature.

## Context

- ADR-0003's addendum: a single multi-tenant Entra ID application; each customer's tenant admin grants consent independently. `MicrosoftTenant` is where that consent relationship lives.
- ADR-0007: `User.entraObjectId` is globally unique specifically because "login resolves identity from the validated token subject claim before organizationId is known" — the underlying reasoning (resolve identity before you know the org) is correct, but the *mechanism* (a bare global unique on `oid` alone) is not, per gap 3 above.
- ADR-0007 also explicitly allows one `Organization` to have multiple `MicrosoftTenant` rows (e.g., subsidiaries on separate Azure AD tenants) — this is precisely the case where "which tenant is this user's identity anchored to" stops being inferable and must be stored.
- Phase 3's repository layer (`packages/database`) is unaffected by this change — it's an additive column/index on an existing tenant-scoped model, not a new access pattern. However, `packages/database/src/identity.ts`'s `findUserByEntraObjectId(entraObjectId)` — the one sanctioned unscoped lookup from Phase 3 — is directly affected: a bare `oid`-only lookup is no longer a safe or correct way to resolve identity once the unique constraint is tenant-scoped. See "Authentication Lookup Flow" below.

## Options Considered

**A. Do nothing — infer the tenant at login time only, don't persist it.**
Would require re-deriving "which `MicrosoftTenant` did this user last authenticate through" from the token on every request rather than storing it, and provides nothing to validate subsequent logins' `tid` claims against. Rejected — pushes a solvable schema gap into ad-hoc runtime logic in the auth layer instead.

**B. Add `User.microsoftTenantId` (required FK to `MicrosoftTenant`) + a standalone index on `MicrosoftTenant.entraTenantId`.**
Records, at first login, which connected Entra tenant a user's identity belongs to; every subsequent login can validate the token's `tid` claim against `user.microsoftTenant.entraTenantId` directly. The standalone index makes the "which `MicrosoftTenant`(s) does this new `tid` map to" first-login query efficient without weakening the existing compound uniqueness guarantee.

## Recommended Decision

**Option B.**

Schema changes (not yet applied — this ADR precedes the migration per your instruction):

- Add `User.microsoftTenantId: String` (required, not nullable — every real `User` row is created at first login, at which point the token's `tid` is already known and resolved to a `MicrosoftTenant`).
- New relation, distinct from the existing `"MicrosoftTenantConsentedBy"` relation (a user can be *the person who granted consent* for a tenant, which is unrelated to *which tenant their own identity belongs to* — these are two different relationships between the same two models and need distinct Prisma relation names, same pattern as `Document`'s two `HealthScore` relations from Phase 2): name it `"UserHomeMicrosoftTenant"`.
- `onDelete: Restrict` on this FK — mirrors `ScanJob.triggeredByUserId → User: Restrict` from Phase 2: a `User`'s home-tenant link is an identity anchor, not something that should silently orphan. `MicrosoftTenant` rows are never hard-deleted in this design anyway (revocation is `status = Revoked`, not a delete), so this is a defense-in-depth constraint, not a practical blocker.
- Add `@@index([entraTenantId])` on `MicrosoftTenant` (standalone, alongside the existing compound `@@unique([organizationId, entraTenantId])`, which stays unchanged) — enables the first-login "resolve `tid` → candidate `MicrosoftTenant` row(s) → `Organization`" query.
- `User.organizationId` is kept as-is (not removed) even though it's now technically derivable through `microsoftTenantId → MicrosoftTenant.organizationId` — consistent with the existing, deliberate denormalization rule from ADR-0001/0007 (every tenant-scoped table keeps its own `organizationId` for direct repository-layer filtering, even when reachable transitively through a parent).
- **Replace `User`'s global `@@unique([entraObjectId])` with a compound `@@unique([microsoftTenantId, entraObjectId])`.** This corrects gap 3: `oid` is only guaranteed unique within the Azure AD tenant that issued it, so the uniqueness constraint must be scoped by `microsoftTenantId`, matching Microsoft's documented `oid` + `tid` guidance exactly (`microsoftTenantId` is our internal FK standing in for `tid`, since `MicrosoftTenant.entraTenantId` is what `tid` resolves to).

### Authentication Lookup Flow

Confirmed as: **JWT `tid` → `MicrosoftTenant` → `User(oid + microsoftTenantId)` → `Organization` → `TenantContext`**, concretely:

1. Validate the incoming JWT; extract `tid` and `oid` claims.
2. Look up `MicrosoftTenant` by `entraTenantId = tid`, using the new standalone `@@index([entraTenantId])`. Because `entraTenantId` is *not* globally unique either (ADR-0007 — the same Azure tenant is not structurally prevented from being connected by more than one `Organization`), this step can in principle return more than one candidate row.
3. Look up `User` by the compound key `{ microsoftTenantId: <candidate.id>, entraObjectId: oid }` for each candidate from step 2. Because `oid` *is* unique within a given tenant, at most one candidate yields a match for an already-provisioned user — this is what actually disambiguates the rare multi-organization-same-Azure-tenant case, not step 2 alone.
4. The matched `User.organizationId` (or equivalently `microsoftTenant.organizationId` — the two must always agree) is the resolved `Organization`.
5. `createTenantContext(organizationId)` produces the `TenantContext` used for the rest of the request.

**Consequence for Phase 3's `identity.ts`**: `findUserByEntraObjectId(entraObjectId)` — the single sanctioned unscoped lookup — is no longer correct as a bare `oid`-only query once the unique constraint is compound. It needs to become a two-step lookup taking both `tid` and `oid` (resolve `MicrosoftTenant` first, then the compound-keyed `User`), per the flow above. This is a **Phase 3 code change**, not just a schema change — flagged here for visibility, but not implemented in this ADR; it should land in the same change as the migration since the old function signature would otherwise silently stop matching the new constraint shape.

**Open edge case, not resolved by this ADR**: if step 2 genuinely returns multiple `MicrosoftTenant` candidates *and* the user is logging in for the very first time (no `User` row yet under any candidate), there is no automatic way to determine which `Organization` they should be provisioned under — that scenario needs an explicit decision (e.g., disallow same-Azure-tenant connection across two Organizations at consent time, or require an invite-based provisioning flow instead of pure first-login auto-provisioning) when the auth service is actually built. Noting it now rather than letting it surface as a surprise later.

## Tradeoffs

- One more required FK on `User` and one more relation name to keep straight (`"UserHomeMicrosoftTenant"` vs. `"MicrosoftTenantConsentedBy"`) — small, bounded complexity for closing a real auth-correctness gap before the auth layer is built on top of it.
- `Restrict` on delete means a `MicrosoftTenant` can never be hard-deleted while any `User` still references it as their home tenant — acceptable since `MicrosoftTenant` deletion was never a real code path in this design (revocation via status change is the sanctioned lifecycle transition, per ADR-0007's lifecycle table).
- This is an additive schema change (new nullable-free column, new index, and a changed unique constraint) requiring a new Prisma migration — no existing data exists yet (still pre-launch), so this is a safe, non-destructive migration once approved, consistent with how prior migrations in this project have been evaluated.
- Moving from a single-column global unique to a compound unique means any future code that assumed "`entraObjectId` alone identifies a `User`" must be updated — currently that's only `identity.ts` (not yet built out beyond the Phase 3 stub), so the blast radius is contained to the one place flagged above.

## Future Considerations

- If a `User` ever needs to legitimately move between an organization's connected `MicrosoftTenant`s (e.g., an employee's account migrates between subsidiary Azure AD tenants), `microsoftTenantId` would need an explicit, audited update path in the auth/admin layer — not a concern for initial sign-in, flagged for whoever builds that flow.
- The full RBAC expansion noted in the original review request (`Viewer`, `Auditor` roles) remains a simple additive enum-value migration when needed — no schema blocker, no ADR required to act on it later.
- The same-Azure-tenant-across-multiple-Organizations edge case flagged above should be revisited explicitly when the consent/onboarding flow (ADR-0003) is implemented — that's the more natural place to decide whether to prevent it outright or handle it via disambiguation.
