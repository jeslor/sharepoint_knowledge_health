# ADR-0019: Audit Log Model

Date: 2026-07-20
Status: Accepted

---

## Problem

A repo-wide search confirmed no `AuditLog`/`AdminActivity` model exists anywhere in this codebase. Governance-issue activity (`ActivityList`, ADR-0016) records changes to a `GovernanceIssue`'s own workflow, but nothing records the broader set of administrative actions a customer will reasonably expect a governance-positioned product to answer for: who approved this SharePoint site, who changed the scan schedule, who triggered this scan, who reconnected Microsoft 365. A product/UX design review this session identified this as a real, currently-total gap that compliance-minded enterprise buyers — this product's own stated positioning — will ask about, and moved it earlier in the phased roadmap specifically because several near-term phases (bulk site approval, schedule integration, reconnect) all want to write into it from the moment they ship, rather than having audit logging retrofitted into each of them later.

## Context

- Every tenant-scoped write in this codebase already goes through `createTenantContext(organizationId)` (ADR-0001) — the same mechanism this ADR's write-helper reuses for isolation, not a new one.
- `ActivityList`/governance activity (ADR-0016) is a distinct, narrower concern (a `GovernanceIssue`'s own status-change history) and is not replaced or subsumed by this ADR — the two remain separate: one tracks a governance issue's lifecycle, this one tracks administrative actions across the product.
- This project's "avoid over-engineering" principle rules out an event-bus or CDC-based audit mechanism for MVP — a plain, directly-written table is sufficient and is what every comparable audit trail in this codebase's own domain (e.g. `MicrosoftTenant.consentGrantedByUserId`/`consentGrantedAt`, `SharePointSite.approvedByUserId`/`approvedAt`) already does at the single-field level; this ADR generalizes that same pattern into one reusable table instead of one bespoke pair of columns per action.

## Decision

### 1. Append-only design

```prisma
model AuditLog {
  id             String   @id @default(cuid())
  organizationId String
  actorUserId    String?  // nullable — a small number of actions (e.g. the
                          // worker's own Revoked transition, ADR-0012's
                          // amendment) have no human actor
  action         String   // e.g. "sharepoint_site.approved", "scan_schedule.updated"
  targetType     String   // e.g. "SharePointSite", "ScanSchedule", "MicrosoftTenant"
  targetId       String
  metadata       Json?    // action-specific detail, e.g. { siteIds: [...] } for a bulk action
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  actorUser    User?        @relation(fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([organizationId, createdAt])
}
```

**No `update`/`delete` repository method is exposed for this model — only `create` and `findMany`.** This is enforced the same way `packages/graph-client`'s read-only surface is enforced (ADR-0013 §8: "no `create`/`update`/`delete` functions exist anywhere in this module's surface — read-only is enforced by the public API shape itself"): the tenant-scoped repository for `AuditLog` simply has no mutation methods beyond `create`, so there is nothing in the codebase capable of altering or removing a written entry short of a direct database operation outside the application entirely. `actorUserId` is nullable and `onDelete: SetNull` (mirroring `MicrosoftTenant.consentGrantedByUserId`'s existing precedent) so a deleted `User` row never cascades away the audit history of what they did.

### 2. Actions that require logging

Written by whichever service already performs the action, via one shared write-helper (`recordAuditLog(context, { action, targetType, targetId, metadata? })` — takes the caller's already-resolved `TenantContext`, so it's always correctly organization-scoped) — not a new service with its own permission surface:

- `sharepoint_site.approved` / `sharepoint_site.approved_bulk` (single approval; and the batched action from the bulk-approval phase, `metadata: { siteIds: [...] }`)
- `sharepoint_site.revoked`
- `scan_schedule.created` / `scan_schedule.updated`
- `scan.triggered` (manual trigger only — a `Scheduled`-`triggerSource` `ScanJob`, ADR-0015 Phase 7B, has no human actor and is not logged here; its existence is already fully recorded by `ScanJob` itself)
- `microsoft_tenant.reconnected` (the Admin-only action from ADR-0012's amendment)
- `microsoft_tenant.revoked` (the worker-driven transition from ADR-0012's amendment — `actorUserId: null`, since no human performed this action; still logged, because "why did this happen and when" is exactly what an audit trail needs to answer even for system-driven events)

**This is the complete mandatory set for the currently-planned phases** — every action listed above must call `recordAuditLog` before that phase is considered done; this list is not illustrative or partial. It is deliberately scoped to what the phased roadmap's own near-term work already produces — not every mutation in the product needs an audit entry on day one (e.g. individual governance-issue status changes already have their own activity feed, ADR-0016, and aren't duplicated here). Extending this list for a future action is an additive change (one more `recordAuditLog` call at the relevant existing call site), not a schema change.

### 3. Tenant isolation

`AuditLog` is tenant-scoped exactly like every other model in this system (ADR-0001) — accessed only through `createTenantContext(organizationId)`, never through an unscoped query. It is **not** a third sanctioned unscoped operation alongside `findUserByEntraIdentity` and `findDueScanSchedules` (`packages/database/src/identity.ts`, `scheduler.ts`) — there is no legitimate cross-tenant read need for audit history, unlike those two, which exist specifically because they run *before* an `organizationId` is known. Every write and every read of `AuditLog` has an `organizationId` in hand already.

**On the model's exact columns, to remove any ambiguity**: `AuditLog` stores `actorUserId` (nullable — see below) and `organizationId` (required, the isolation boundary). It does **not** have a separate `microsoftTenantId`/`tenantId` column. "Tenant" is overloaded in this codebase — `organizationId` is the multi-tenancy isolation boundary (ADR-0001's sense of "tenant"), while a specific connected Microsoft 365 tenant is its own `MicrosoftTenant` row, one of potentially several per organization (ADR-0007). For an action about a specific `MicrosoftTenant` (e.g. `microsoft_tenant.reconnected`/`.revoked`), that row's id is already captured precisely via `targetType: "MicrosoftTenant"` + `targetId`, so a second, redundant `microsoftTenantId` column would just duplicate what `targetId` already says whenever `targetType` is `"MicrosoftTenant"`, and would be meaningless (always null) for every other action type. One `organizationId` + `targetType`/`targetId` pair is sufficient and avoids a column that's only ever populated for one specific `targetType`.

**On nullable actors, restated plainly**: `actorUserId` is nullable specifically and only for system-generated events (currently: the worker-driven `microsoft_tenant.revoked` transition, ADR-0012's amendment) — every action a human performs through the API always has a real `actorUserId`, resolved from the authenticated caller the same way every other Admin-gated mutation in this codebase already does (`RolesGuard`'s resolved `User`), never left null for a human-triggered action.

### 4. API surface

`GET /organizations/:id/audit-log` (paginated, cursor or offset matching this codebase's existing pagination convention) — any authenticated org member may read it (matches how governance activity feeds are already readable by non-Admins; audit *visibility* is not the same restriction as the *ability to perform* the audited actions, most of which already require `Admin`).

## Acceptance Criteria

- `recordAuditLog` is called from every action listed in §2's call sites, verified by a test per call site asserting exactly one `AuditLog` row is created with the correct `action`/`targetType`/`targetId`.
- No code path can update or delete an `AuditLog` row — verified by the repository layer exposing no such method, not merely by convention.
- `GET /organizations/:id/audit-log` never returns another organization's rows — verified by the existing tenant-isolation test pattern (`packages/database`'s `tenant-isolation.spec.ts` precedent) extended to this model.

## Tradeoffs

- One shared `action`/`targetType`/`targetId`/`metadata` shape (rather than a strongly-typed row per action) trades some type safety for not needing a new table per audited action — acceptable given this project's existing precedent of using a similar loosely-typed shape for `HealthIssue`'s per-criterion detail, and because `action` values are a small, code-reviewed, closed set in practice even though the column itself is a plain string.
- No automatic retention/pruning policy is defined here — `AuditLog` grows unboundedly, same accepted-for-now posture ADR-0015 §2 already took for `ScanJob`/`HealthScore` ("no automatic pruning is proposed... a separate, explicit decision... not solved speculatively here").

## Future Considerations

- A dedicated audit-log UI page (filterable by action/actor/date) is a reasonable later addition once the underlying data exists — this ADR only makes the capability exist, per the phased roadmap's explicit split.
- If `AuditLog` volume ever becomes large enough to need archival, that's the same class of future decision ADR-0015 §2 already deferred for `ScanJob`/`HealthScore` — should be designed together, not solved separately per table.
- Strongly-typed per-action metadata (a discriminated union keyed by `action` instead of a loose `Json?`) is a reasonable refinement once the action list stabilizes — not needed at this list's current size.
