# ADR-0011: Authentication Trust Model

Date: 2026-07-11
Status: Accepted

---

## Problem

ADR-0010 fixed *how* user identity is resolved (`tid` + `oid`, compound-scoped), but never stated *why* those two claims specifically, or what the application is explicitly forbidden from trusting as identity. Without that stated explicitly, it's easy for a later auth implementation to reach for a "simpler" field — email, display name, a domain match — as a shortcut, reintroducing exactly the class of bug ADR-0010 just closed. This ADR states the trust boundary as policy, before the auth layer that depends on it is built.

## Context

- ADR-0003 (addendum): a single multi-tenant Entra ID application; each customer's tenant admin grants consent independently, and end users sign in against their own organization's Azure AD tenant.
- ADR-0010: `oid` is only unique within the Azure AD tenant that issued it; Microsoft's own multi-tenant guidance requires `oid` + `tid` together as the identifying key, confirmed and implemented as `findUserByEntraIdentity(entraTenantId, entraObjectId)`.
- Verified against the current schema: `User.email` and `User.displayName` carry **no** uniqueness constraint (confirmed by inspection — only `@@unique([microsoftTenantId, entraObjectId])` exists on `User`) — consistent with this ADR's decision, not something that needs correcting.
- No auth middleware/guard exists yet in `apps/api` — this ADR is written ahead of that implementation specifically so it's built against a stated policy, not improvised claim-by-claim.

## Decision

**Trusted, and the only basis for identity/authorization decisions:**

1. **Microsoft Entra ID** as the identity provider — trust is anchored in a cryptographically validated JWT (signature verified against Entra's published JWKS, `iss`/`aud`/`exp`/`nbf` checked), not in anything self-asserted by the client.
2. **JWT `tid` claim** for tenant identity — resolves to a `MicrosoftTenant.entraTenantId`.
3. **JWT `oid` claim** for user identity within that tenant — resolves to a `User.entraObjectId`, always scoped by `microsoftTenantId` (never alone, per ADR-0010).

**User resolution requires both, together: `(tid, oid)`.** Neither claim is sufficient alone — this is already the exact shape of `findUserByEntraIdentity(entraTenantId, entraObjectId)`; this ADR is what makes that a stated policy rather than an incidental consequence of a schema fix.

**Explicitly not trusted as identity, and never usable in an identity/authorization lookup:**

- **Email address** — mutable (a user or tenant admin can change it in Azure AD at any time); using it as a lookup key creates an account-takeover path if a new user is later assigned an email a former user once held.
- **Display name** — trivially self-editable, sometimes even by the user themselves; carries no security meaning.
- **Username / UPN** — same mutability problem as email; Microsoft's own guidance is explicit that `oid` is "the only claim that should be used to uniquely and reliably identify users," not UPN.
- **Domain name** — a single Entra tenant can have multiple verified domains, and "your email domain matches ours" is a classic, spoofable auto-provisioning anti-pattern (anyone can claim any domain in an unverified field; even where verified, domain is not the tenant-isolation boundary — `tid` is).

These fields remain in the schema (`User.email`, `User.displayName`) and stay useful for **display and profile sync only** (e.g., "Welcome, Jane," updated from the token on each login) — this ADR does not remove them, it forbids using them as a `WHERE` clause for identity or authorization.

## Concrete Rules for the Auth Implementation (not yet built)

Binding on whatever builds the actual auth middleware/guard in `apps/api`:

1. Validate the JWT's signature, issuer, audience, and expiry before reading *any* claim out of it. An unvalidated token's claims are not evidence of anything.
2. Resolve identity via `findUserByEntraIdentity(tid, oid)` only. No fallback path that resolves a user by email, username, or any other claim — if `(tid, oid)` doesn't resolve, treat as an unrecognized identity (first-login provisioning or reject), never silently match on a different attribute.
3. On every login, `email`/`displayName` may be **written** (synced from the fresh token) but never **read** as part of a `WHERE` clause anywhere in the auth path.
4. No auto-provisioning or auto-join logic keyed on email domain. If domain-based organization suggestion is ever wanted as a UX convenience (e.g., "did you mean to join Acme?"), it must be presented as a suggestion requiring explicit user/admin action, never as an automatic trust decision.
5. Authorization checks (role/permission gates, once RBAC exists per the earlier schema review) must be derived from the resolved `User` row's own `role`/`status` fields — never inferred from token claims like email or group-display-name strings.

## Tradeoffs

- Slightly more ceremony at first login (must have both `tid` and `oid`, never a single simpler claim) — accepted because this is the actual, correct security boundary; a simpler-looking shortcut here is a latent vulnerability, not a simplification.
- Display fields (`email`, `displayName`) still need periodic sync-on-login logic to stay current, since they're explicitly not authoritative identity — this is ordinary profile-sync work, not a security-sensitive path.

## Future Considerations

- If RBAC expands beyond `Admin`/`Member` (per the earlier schema review), role resolution must continue to come from the `User` row, never from Entra group claims directly, unless a deliberate future ADR decides to map Entra groups to roles explicitly (that would be a new, separate trust decision, not an extension of this one).
- If SCIM-based or admin-driven user provisioning is added later (as an alternative to lazy first-login provisioning), it must still ultimately anchor each provisioned `User` row to a `(microsoftTenantId, entraObjectId)` pair before the account is usable — provisioning by email invite is fine as a UX flow, but the account isn't "real" until an actual Entra sign-in resolves and fills in the `oid`.
