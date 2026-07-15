# ADR-0012: Organization Onboarding and User Provisioning

Date: 2026-07-11
Status: Accepted

---

## Problem

ADR-0001 through ADR-0011 establish tenant isolation, the domain model, the repository layer, and the identity trust model — but nothing yet defines the actual bootstrapping sequence: how an `Organization` row comes to exist in the first place, how a `MicrosoftTenant` gets connected, how the very first `User` is provisioned (before there's any Admin to grant them access), and what happens when a second, third, or hundredth person from the same company signs in. Phase 4 authentication cannot be built without this decided — it's the one part of the flow that happens *before* any `TenantContext` exists.

## Context

- ADR-0001: row-level multi-tenancy via `organizationId`; `OrganizationRepository` deliberately has no `create()` — creating an `Organization` was already flagged in Phase 3 as "a bootstrap/signup operation that precedes any tenant context."
- ADR-0003 addendum: a single multi-tenant Entra ID app; each customer's tenant admin grants **admin consent** independently — this is already a real, externally-verified privileged action (only a Global Admin or an equivalently privileged Entra role can complete it), not something we invented.
- ADR-0007: `MicrosoftTenant.consentGrantedByUserId` is already **nullable**, and `MicrosoftTenant.status` already has a `PendingConsent` state — the schema was already shaped to support a bootstrap sequence where the connecting `MicrosoftTenant` exists briefly before the `User` who consented to it does.
- ADR-0010: identity resolves via `(tid, oid)`, scoped by `MicrosoftTenant`; the standalone `@@index([entraTenantId])` was built specifically to answer "does a `MicrosoftTenant` for this Azure tenant already exist anywhere" — exactly the question this ADR's flow needs answered.
- ADR-0011: email, display name, username, and domain are explicitly not trusted for identity. That same principle extends here: organization creation and user provisioning must not be gated on any self-asserted or guessable signal (e.g., "your email domain matches ours") — only on cryptographically verified Entra facts.

## Decision

### 1. How Organizations are created

**An `Organization` is created only as a side effect of a Microsoft admin-consent flow completing — there is no separate, Entra-disconnected "sign up with email" step.**

"Connect your Microsoft 365 tenant" *is* the signup action. A prospective customer's Global Admin (or equivalently privileged role) initiates Microsoft's admin-consent flow (ADR-0003's app-only `Files.Read.All`/`Sites.Read.All` scopes); the same browser session also yields that admin's own delegated sign-in token (`tid` + `oid`). Before creating anything, the backend first checks whether a `MicrosoftTenant` with this `entraTenantId` **already exists** (via ADR-0010's standalone index):

- **No existing match** → this is a genuinely new customer. Create `Organization`, `MicrosoftTenant`, and the first `User` together (see §3).
- **Existing match** → this Azure tenant is already connected to an `Organization` in our system. Do **not** create a second `Organization`. Route this person into the existing organization's first-sign-in flow instead (see §4) — this is what prevents the "same Azure tenant under two different Organizations" edge case ADR-0010 flagged as unresolved from happening through the normal self-service path.

Because this decision is anchored in Microsoft's own admin-consent privilege check rather than anything self-asserted, it's a direct extension of ADR-0011's trust model to org creation, not a separate policy.

*Out of scope for this ADR*: whether the "Connect Microsoft 365" entry point itself is gated by a waitlist, sales approval, or is fully open — that's a go-to-market/business decision, not a schema or security concern, and doesn't change the technical flow above.

### 2. How MicrosoftTenant connections are created

Two distinct paths, both producing a `MicrosoftTenant` row via the same admin-consent redirect (ADR-0003):

- **First connection for a brand-new Organization** — created as part of the bootstrap transaction in §1/§3.
- **Additional connection for an existing Organization** (e.g., a subsidiary's separate Azure AD tenant, per ADR-0007's explicit one-org-to-many-tenants design) — initiated by an already-authenticated `Admin`-role `User`, scoped to their existing `organizationId`. **Restricted to `Admin` role** — a `Member` cannot connect a new Microsoft tenant to the organization. `consentGrantedByUserId` is set immediately to the initiating (already-existing) `User`'s id — no chicken-and-egg problem here, since that `User` already exists.

### 3. How the first Admin user is provisioned

The **first** `User` created for a brand-new `Organization` is the person who completed the admin-consent flow in §1. They are provisioned as `role: Admin, status: Active` — immediately, with no approval step (there is, by definition, no one else yet to approve them).

This is deliberately **not** a self-declared "make me admin" checkbox — the Admin designation is inherited entirely from Microsoft's own privilege check (only a sufficiently privileged Entra role can complete tenant-wide admin consent in the first place). We are not inventing a new trust decision here, only relaying one Microsoft already made.

**Bootstrap sequence** (single Prisma `$transaction`, to avoid an orphaned half-created `Organization` on partial failure):
1. Create `Organization`.
2. Create `MicrosoftTenant` (`organizationId` = new org, `entraTenantId` = admin's `tid`, `status: Consented`, `consentGrantedAt: now`, `consentGrantedByUserId: null` — nullable exactly for this reason).
3. Create `User` (`organizationId` = new org, `microsoftTenantId` = new tenant, `entraObjectId` = admin's `oid`, `role: Admin`, `status: Active`).
4. Update the `MicrosoftTenant` row from step 2, setting `consentGrantedByUserId` to the `User` created in step 3.

This bootstrap is, alongside `identity.ts`'s identity resolution, the **second and only other sanctioned unscoped operation** in this system — it necessarily runs before any `organizationId` (and therefore `TenantContext`) exists. It does not belong in the tenant-scoped repository layer (ADR-0001/Phase 3) and should live in its own clearly-named module when implemented (e.g., an `onboarding` service in `apps/api`, using the raw client the same way `identity.ts` and the isolation tests' seed helpers already do) — not implemented in this ADR, per your instruction.

### 4. New user provisioning model

**Automatic provisioning with mandatory Admin approval** — not pure invite-only, not fully automatic.

Any person who successfully signs in with a valid Entra token whose `tid` matches an **already-`Consented`** `MicrosoftTenant` may do so without a prior invitation — but the resulting `User` row is created as `role: Member, status: PendingApproval` (a new value added to the existing `UserStatus` enum) and has **no access to any tenant data** until an existing `Admin` explicitly approves them (`status → Active`).

This is a deliberate middle ground, chosen over the two alternatives:

- **Pure automatic provisioning (no approval gate)** — rejected. It would mean anyone who can authenticate against the customer's Azure AD automatically gets access to a tool that surfaces sensitive cross-tenant SharePoint governance data (document ownership gaps, staleness, etc.) — too broad a default for a product whose entire positioning is governance and access hygiene, and inconsistent with ADR-0011's precedent that automatic trust decisions require explicit action, not inference.
- **Pure invite-only (no self-service discovery at all)** — rejected for now, not because it's wrong, but because it requires a new `Invitation` entity (email, role, organizationId, expiry, status) that doesn't exist yet and isn't needed to satisfy the actual security requirement. The approval-gate model achieves the same "an Admin must explicitly act before access is granted" guarantee with a one-value enum addition instead of a new model. Full invitations (including pre-assigning a role before first sign-in) remain a reasonable v2 addition — see Future Considerations.

**Important distinction, connecting back to ADR-0011**: `PendingApproval` status governs *authorization* (should this person have access), not *identity* (who is this person). Identity resolution via `(tid, oid)` still happens in full for a pending user — we know exactly who they are, cryptographically, from the moment they first sign in. We simply withhold access rights until an `Admin` acts. This is a clean separation of concerns, not a weakening of ADR-0011.

## Acceptance Criteria

This ADR is not implemented until these tests exist and pass. Two proposed function names are used below purely to make the criteria concrete and testable — the actual Phase 4 implementation may name them differently, but the *behavior* asserted is binding:

- `provisionOrganizationFromConsent(entraTenantId, entraObjectId, tenantName)` — the §3 bootstrap transaction (brand-new organization path).
- `provisionUserFromExistingTenant(microsoftTenantId, entraObjectId, ...)` — the §4 path (new person, already-connected tenant).

Tests split across two layers: `packages/database` (transaction/data correctness — no HTTP involved) and `apps/api` (the authorization guard, once it exists).

### 1. First admin consent creates Organization + MicrosoftTenant + Admin User

`packages/database`, integration test against real Postgres (matching the existing `tenant-isolation.spec.ts`/`identity.spec.ts` pattern):

```
describe('provisionOrganizationFromConsent', () => {
  it('creates exactly one Organization, one MicrosoftTenant, and one User', async () => {
    const result = await provisionOrganizationFromConsent(entraTenantId, entraObjectId, tenantName);

    const org = await prisma.organization.findUnique({ where: { id: result.organizationId } });
    const tenant = await prisma.microsoftTenant.findUnique({ where: { id: result.microsoftTenantId } });
    const user = await prisma.user.findUnique({ where: { id: result.userId } });

    expect(org).not.toBeNull();
    expect(tenant?.organizationId).toBe(org!.id);
    expect(tenant?.entraTenantId).toBe(entraTenantId);
    expect(tenant?.status).toBe('Consented');
    expect(user?.organizationId).toBe(org!.id);
    expect(user?.microsoftTenantId).toBe(tenant!.id);
    expect(user?.entraObjectId).toBe(entraObjectId);
  });

  it('backfills MicrosoftTenant.consentGrantedByUserId to the created User after creation', async () => {
    const result = await provisionOrganizationFromConsent(entraTenantId, entraObjectId, tenantName);
    const tenant = await prisma.microsoftTenant.findUnique({ where: { id: result.microsoftTenantId } });
    expect(tenant?.consentGrantedByUserId).toBe(result.userId);
  });
});
```

### 2. Existing entraTenantId cannot create a duplicate Organization

`packages/database`:

```
it('routes a second consent attempt for an already-connected tenant into the existing Organization, not a new one', async () => {
  const first = await provisionOrganizationFromConsent(entraTenantId, oidAdmin, tenantName);

  const orgCountBefore = await prisma.organization.count();
  const second = await provisionOrganizationFromConsent(entraTenantId, oidSecondPerson, tenantName);
  const orgCountAfter = await prisma.organization.count();

  expect(orgCountAfter).toBe(orgCountBefore); // no new Organization created
  expect(second.organizationId).toBe(first.organizationId); // routed into the existing org
  expect(second.userId).not.toBe(first.userId); // still a distinct new User (see criterion 4)
});
```

### 3. First admin gets role: Admin, status: Active

`packages/database` (can be folded into criterion 1's test or kept separate for clarity):

```
it('provisions the first user as an active admin, no approval step', async () => {
  const result = await provisionOrganizationFromConsent(entraTenantId, entraObjectId, tenantName);
  const user = await prisma.user.findUnique({ where: { id: result.userId } });

  expect(user?.role).toBe('Admin');
  expect(user?.status).toBe('Active');
});
```

### 4. New user from same tenant: identity resolves, status = PendingApproval, API denies access

Split across both layers:

`packages/database`:

```
it('provisions a second person from the same tenant as a pending, non-admin member', async () => {
  const admin = await provisionOrganizationFromConsent(entraTenantId, oidAdmin, tenantName);
  const created = await provisionUserFromExistingTenant(admin.microsoftTenantId, oidNewPerson, /* profile */);

  expect(created.role).toBe('Member');
  expect(created.status).toBe('PendingApproval');
  expect(created.organizationId).toBe(admin.organizationId);

  // Identity resolution succeeds end-to-end once provisioned — this is
  // the "not found -> provision -> now resolvable" flow completing.
  const resolved = await findUserByEntraIdentity(entraTenantId, oidNewPerson);
  expect(resolved?.id).toBe(created.id);
});
```

`apps/api` (once the auth guard exists — this test cannot be written until then, flagged as a Phase 4 dependency, not a `packages/database` concern):

```
it('rejects API access for a PendingApproval user', async () => {
  // Arrange: a PendingApproval user's valid, signature-correct JWT.
  const response = await request(app.getHttpServer())
    .get('/some-authenticated-route')
    .set('Authorization', `Bearer ${pendingApprovalUserToken}`);

  expect(response.status).toBe(403);
});
```

### 5. Failed bootstrap transaction leaves no partial records

`packages/database` — proves the `$transaction` wrapping in §3 is real, not just described:

```
it('rolls back completely if any step of the bootstrap transaction fails', async () => {
  const orgCountBefore = await prisma.organization.count();
  const tenantCountBefore = await prisma.microsoftTenant.count();
  const userCountBefore = await prisma.user.count();

  // Force a failure inside the transaction — e.g. an entraObjectId that
  // violates a constraint the User-creation step depends on, or an
  // injected failure via a test-only hook/mock on the third step.
  await expect(
    provisionOrganizationFromConsent(entraTenantId, invalidEntraObjectId, tenantName),
  ).rejects.toThrow();

  expect(await prisma.organization.count()).toBe(orgCountBefore);
  expect(await prisma.microsoftTenant.count()).toBe(tenantCountBefore);
  expect(await prisma.user.count()).toBe(userCountBefore);
});
```

## Tradeoffs

- The bootstrap transaction (§3) is the most structurally novel piece of code in the auth layer — three creates and an update, atomically, entirely outside the tenant-scoped repository pattern. Worth extra scrutiny/testing specifically because of that novelty when it's implemented.
- `PendingApproval` users add a UX requirement (an approval inbox/screen for Admins) that doesn't exist yet — small added scope for Phase 4, justified by the access-control gap the alternative (pure auto-provisioning) would leave open.
- Allowing the same Azure tenant to connect to more than one `Organization` (ADR-0007) is still not hard-prevented at the schema level — this ADR's self-service flow steers normal usage away from it (§1), but a deliberate multi-org-same-tenant setup would need to go through a non-self-service (e.g., support-assisted) path. Accepted as a reasonable, low-frequency edge case rather than a schema-level hard constraint, consistent with "avoid over-engineering."

## Future Considerations

- A full `Invitation` model (pre-assign email + role before first sign-in) is a reasonable v2 addition once there's evidence customers want to provision access ahead of someone's first login — doesn't conflict with anything decided here, since an invited `User` would still ultimately need a real `(tid, oid)` sign-in to become `Active`, exactly as `PendingApproval` users do today.
- If a support-assisted "connect the same Azure tenant to a second Organization" path is ever built, it should require explicit internal-team action (not exposed as a self-service option), to avoid accidentally normalizing the edge case this ADR's flow otherwise prevents.
- The approval-inbox UX (which `Admin` sees pending users, how they're notified) is a product/frontend design question for whoever implements Phase 4 — not decided here.

## Amendment (2026-07-15, Phase 6): "Connect Microsoft 365" frontend flow, and a deferred server-side verification gap

LAT execution (`docs/testing/local-acceptance-testing-report.md`, Finding #1)
found that `apps/web` had no code path calling `POST /auth/consent-callback`
at all — the endpoint this ADR specifies has always worked correctly
(confirmed by `packages/database/src/onboarding.spec.ts` against all 5
acceptance criteria above), but nothing in the product ever reached it.
Phase 6 closed that gap with a frontend-only implementation
(`apps/web/src/app/connect/*`) — no change to this ADR's decisions, no
backend change, no schema change:

1. A new `/connect` entry page collects the organization name and navigates
   (a raw, non-MSAL-mediated redirect) to Microsoft's own tenant-wide
   admin-consent endpoint for this app's `Files.Read.All`/`Sites.Read.All`
   scopes (ADR-0003).
2. A new `/connect/admin-consent-callback` page (a second, separately
   registered redirect URI) receives Microsoft's admin-consent result and,
   on success, hands off to the existing MSAL `loginRedirect` sign-in flow
   unchanged.
3. A new `/connect/finishing` page — reached via a small, additive check in
   `apps/web/src/app/page.tsx` — calls the existing `/auth/consent-callback`
   with the resulting ID token, and routes on all four `ConsentResolution`
   `kind` values from §1/§4 above (`existing`, `bootstrapped`,
   `provisioned-pending`, `rejected`) exhaustively.

**Deferred, not closed by this amendment**: `resolveOrProvisionFromConsent`
still has no way to cryptographically verify that Microsoft's real
tenant-wide admin-consent grant actually happened before setting
`MicrosoftTenant.status: 'Consented'` — it trusts any successful sign-in
token from a previously-unseen `tid`. The Phase 6 flow above makes the real
admin-consent grant a genuine, Microsoft-verified *UI* gating step (a
substantial practical improvement over the prior state, where nothing
enforced this at all), but a sufficiently motivated caller could still call
`/auth/consent-callback` directly with nothing but a valid ID token and
skip the admin-consent step entirely — exactly as the LAT dev workaround
already did before this flow existed. Closing this fully would require
`apps/api` to make an authenticated Microsoft Graph call (e.g.
`GET /servicePrincipals/{id}/appRoleAssignedTo`, comparing granted app
roles against ADR-0003's `Files.Read.All`/`Sites.Read.All`) — a genuinely
new integration surface, since `apps/api` today only ever verifies incoming
ID tokens and never calls Graph itself (`docs/architecture/deployment.md`).
Flagged here as named future work, not solved in Phase 6.
