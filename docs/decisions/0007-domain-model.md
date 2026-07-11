# ADR-0007: Domain Model

Date: 2026-07-11
Status: Accepted

---

## Problem

ADR-0001 through ADR-0006 establish the tenancy model, scoring algorithm, Graph permissions, scan architecture, MVP scope, and infrastructure — but no entity model exists yet that ties them together. Phase 1 implementation cannot begin without a defined, agreed domain model, tenant isolation rules, and lifecycle states. This ADR defines that model at the conceptual level; it does not define a Prisma schema.

## Context

- Row-level multi-tenancy via `organizationId` (ADR-0001).
- Rule-based scoring with six weighted criteria and per-criterion issues (ADR-0002).
- Multi-tenant Entra ID app; each `Organization` connects its own Microsoft 365 tenant via admin consent (ADR-0003 addendum).
- Scans are async, queue-backed jobs (ADR-0004).
- Duplication uses a basic exact-match signal in MVP (ADR-0005).
- Pricing/plan gating is out of scope for MVP, but the model should not need a breaking schema change to add limits later (per this round's instructions).

## Entities

### Organization

The customer account — the tenant of *our* SaaS product (distinct from the customer's Microsoft/Entra tenant).

- `id`
- `name`
- `createdAt`, `updatedAt`
- `status` (`Active`, `Suspended`) — lifecycle for the account itself, independent of any individual scan or user.

**Ownership**: root of the tenancy tree. Every other tenant-scoped entity either belongs to an `Organization` directly or transitively through a parent that does.

**Future-limits design note**: no plan/limit fields are added now (no billing per this round's decision). Because `ScanJob` creation and `Document`/`SharePointSite` counts are already queryable per `organizationId`, future limits (max documents scanned, scan frequency, number of connected `MicrosoftTenant`s, user seats) can be enforced later as a check performed *before* creating a `ScanJob`, `User`, or `MicrosoftTenant` row, against a future `Organization.planLimits` field or a separate `Plan` entity — this requires an additive migration, not a redesign of existing tables.

---

### User

A person who signs into the SharePoint Knowledge Health dashboard.

- `id`
- `organizationId` (FK)
- `entraObjectId` — the subject claim from their Entra ID token, used to resolve identity on login.
- `email`, `displayName`
- `role` (`Admin`, `Member`) — `Admin` can trigger scans and manage tenant connections; `Member` has read-only dashboard access. Kept to two roles for MVP; not modeled as a many-to-many permissions system.
- `status` (`Active`, `Deactivated`)
- `createdAt`, `lastLoginAt`

**Relationships**: belongs to exactly one `Organization`. A person at a company with multiple connected Microsoft tenants is still one `User` under one `Organization` — `MicrosoftTenant` is a separate concept (below).

**Ownership**: `Organization` owns `User`. A `User` is never shared across organizations.

---

### MicrosoftTenant

Represents one customer's connected Microsoft 365 / Azure AD tenant.

- `id`
- `organizationId` (FK)
- `entraTenantId` — the customer's actual Azure AD tenant ID.
- `tenantName` (display name pulled from Entra at consent time)
- `status` (`PendingConsent`, `Consented`, `Revoked`) — lifecycle of the admin-consent relationship.
- `consentGrantedAt`, `consentGrantedByUserId` (FK to `User`)
- `createdAt`

**Relationships**: belongs to one `Organization`. An `Organization` can have more than one `MicrosoftTenant` (e.g., a customer with multiple subsidiaries on separate Azure AD tenants) — the model supports this even though MVP UI may only expose connecting a single tenant.

**Ownership**: `Organization` owns `MicrosoftTenant`. `MicrosoftTenant` in turn owns everything scanned from that Microsoft 365 environment (`SharePointSite` and below).

**Lifecycle**: `PendingConsent` → `Consented` → `Revoked`. Only `Consented` tenants are eligible for `ScanJob` creation. `Revoked` tenants retain historical data (documents, scores) but are excluded from new scans.

---

### SharePointSite

A SharePoint site discovered under a connected Microsoft tenant.

- `id`
- `organizationId` (FK, denormalized — see Tenant Isolation Rules)
- `microsoftTenantId` (FK)
- `graphSiteId` — the Graph API site identifier.
- `siteUrl`, `displayName`
- `lastScannedAt`
- `createdAt`

**Relationships**: belongs to one `MicrosoftTenant`.

**Ownership**: `MicrosoftTenant` owns `SharePointSite`.

---

### Document

A single SharePoint document tracked for health scoring.

- `id`
- `organizationId` (FK, denormalized)
- `siteId` (FK to `SharePointSite`)
- `graphItemId` — the Graph API drive item identifier.
- `name`, `path`, `fileType`, `sizeBytes`
- `sourceCreatedAt`, `sourceModifiedAt` — timestamps from SharePoint itself (used by the Freshness/Age criteria).
- `status` (`Active`, `Removed`) — see Lifecycle States.
- `currentHealthScoreId` (nullable FK to `HealthScore`) — denormalized pointer to the latest score for fast dashboard reads, avoiding a `MAX(calculatedAt)` query on every page load.
- `ingestedAt`

**Relationships**: belongs to one `SharePointSite`. Has many `DocumentOwner` records and many `HealthScore` records (one per scan that covered it).

**Ownership**: `SharePointSite` owns `Document`.

---

### DocumentOwner

Ownership signal(s) for a document. Modeled as a child entity rather than a single field because ownership in SharePoint is often ambiguous — there can be an original author, a different assigned business owner, or no clear owner at all — and that ambiguity is itself an input to the Ownership scoring criterion (ADR-0002).

- `id`
- `documentId` (FK)
- `organizationId` (FK, denormalized)
- `ownerType` (`Author`, `AssignedOwner`, `Unknown`)
- `displayName`, `email` (nullable — a `Document` may have zero resolvable owners, which is itself a scored condition)
- `source` (`GraphMetadata`, `ManualAssignment`) — MVP only populates `GraphMetadata`-sourced authorship; `ManualAssignment` is reserved for a future feature allowing customers to explicitly assign a governance owner.

**Relationships**: belongs to one `Document`. A `Document` can have zero, one, or multiple `DocumentOwner` rows.

**Ownership**: `Document` owns `DocumentOwner`. Do not confuse this with tenant ownership — `DocumentOwner` describes who owns the *SharePoint content*, not which `Organization` the row belongs to (that's still `organizationId`).

---

### ScanJob

A single execution of the scan pipeline (ADR-0004).

- `id`
- `organizationId` (FK)
- `microsoftTenantId` (FK) — a `ScanJob` scans one connected tenant at a time.
- `triggeredByUserId` (FK to `User`)
- `status` (`Queued`, `Running`, `Completed`, `Failed`, `Cancelled`)
- `startedAt`, `completedAt`
- `documentsScanned`, `documentsFailed` (counts)
- `errorSummary` (nullable)
- `createdAt`

**Relationships**: belongs to one `Organization` and one `MicrosoftTenant`. Produces many `HealthScore` rows (one per document scanned in that run).

**Ownership**: `Organization` owns `ScanJob`.

**Lifecycle**: `Queued` → `Running` → (`Completed` | `Failed` | `Cancelled`). Terminal states are final; a new scan is always a new `ScanJob` row, never a re-opened one — this preserves an audit trail of every scan attempt.

**Future-limits design note**: enforcing "scan frequency" or "max documents scanned" later means checking existing `ScanJob` rows (e.g., `COUNT` in the current billing period, or time since `lastCompletedScan`) before allowing a new `Queued` row to be inserted. No new relationship is required — only a validation step in the service that creates `ScanJob` rows.

---

### HealthScore

The result of scoring one document during one scan.

- `id`
- `organizationId` (FK, denormalized)
- `documentId` (FK)
- `scanJobId` (FK) — which scan produced this row.
- `compositeScore` (0–100)
- `freshnessScore`, `ownershipScore`, `reviewStatusScore`, `metadataScore`, `duplicationScore`, `ageScore` (each 0–100, per ADR-0002 criteria)
- `healthBand` (`Healthy`, `NeedsAttention`, `RequiresReview` — derived from `compositeScore` per ADR-0002 bands, stored rather than recomputed on read)
- `calculatedAt`

**Relationships**: belongs to one `Document` and one `ScanJob`. Has many `HealthIssue` rows.

**Ownership**: `Document` owns its `HealthScore` history; `ScanJob` owns the batch of `HealthScore` rows it produced.

**Design note — no separate `ScoreHistory` entity**: historical trend (a dashboard requirement per `document-health-score.md`) is simply the set of `HealthScore` rows for a `Document` ordered by `calculatedAt`. A dedicated `ScoreHistory` table would duplicate this data. `Document.currentHealthScoreId` denormalizes only the *latest* pointer for fast reads; the full history is always the `HealthScore` table itself. `HealthScore` rows are immutable once written — there is no lifecycle/status field because a completed score is never edited, only superseded by a newer row from a later scan.

---

### HealthIssue

A flagged problem on one scoring criterion for one `HealthScore`.

- `id`
- `organizationId` (FK, denormalized)
- `healthScoreId` (FK)
- `criterion` (`Freshness`, `Ownership`, `ReviewStatus`, `Metadata`, `Duplication`, `Age`)
- `severity` (derived from the same bands as the composite score, applied to the sub-score: `NeedsAttention`, `RequiresReview`)
- `message` — human-readable reason (e.g., "Not modified in 18 months", "No identifiable owner").
- `createdAt`

**Relationships**: belongs to one `HealthScore`. Generated automatically whenever a sub-score falls below 70 (ADR-0002); a `HealthScore` with all sub-scores ≥ 70 has zero `HealthIssue` rows.

**Ownership**: `HealthScore` owns `HealthIssue`. Since `HealthScore` is immutable, `HealthIssue` rows are also immutable and never updated after creation.

---

## Relationship Summary

```
Organization 1───* User
Organization 1───* MicrosoftTenant
MicrosoftTenant 1───* SharePointSite
SharePointSite 1───* Document
Document 1───* DocumentOwner
Document 1───* HealthScore            (history; latest pointed to by Document.currentHealthScoreId)
Organization 1───* ScanJob
MicrosoftTenant 1───* ScanJob
ScanJob 1───* HealthScore              (all scores produced by that scan run)
HealthScore 1───* HealthIssue
```

## Tenant Isolation Rules

- `organizationId` is a required, non-nullable column on **every** entity in this model, including child entities that already reach `Organization` transitively through a parent FK (e.g., `HealthIssue`, `DocumentOwner`, `HealthScore`). This is deliberate denormalization: per ADR-0001, tenant scoping is enforced centrally (repository/middleware layer) by filtering on `organizationId` directly, without requiring a join up the entity tree on every query.
- No entity in this model is ever shared across two `Organization`s. There is no global/shared `Document` or `SharePointSite` table keyed by content — even if two customers happened to connect the same Microsoft tenant (not expected, but not structurally prevented at the Graph level), their `SharePointSite`/`Document` rows are fully independent per `organizationId`.
- `MicrosoftTenant.entraTenantId` is not treated as a uniqueness constraint across organizations — isolation is enforced by `organizationId`, not by assuming one Microsoft tenant maps to exactly one `Organization` forever.

## Lifecycle States Summary

| Entity | States | Transitions |
|---|---|---|
| `Organization` | `Active`, `Suspended` | `Active` → `Suspended` (manual admin action; no automated transition in MVP) |
| `User` | `Active`, `Deactivated` | `Active` → `Deactivated` |
| `MicrosoftTenant` | `PendingConsent`, `Consented`, `Revoked` | `PendingConsent` → `Consented` → `Revoked` |
| `Document` | `Active`, `Removed` | `Active` → `Removed` (set when a rescan no longer finds the item in SharePoint; soft-deleted, not hard-deleted, to preserve `HealthScore` history) |
| `ScanJob` | `Queued`, `Running`, `Completed`, `Failed`, `Cancelled` | `Queued` → `Running` → (`Completed` \| `Failed` \| `Cancelled`); terminal, never reopened |
| `HealthScore` | none (immutable, append-only) | n/a |
| `HealthIssue` | none (immutable, append-only) | n/a |
| `DocumentOwner` | none (replaced wholesale on rescan, not individually transitioned) | n/a |

## Future Considerations

- `Plan`/`planLimits` as a future addition to `Organization` (or a separate `Plan` entity) for billing gating — deliberately not modeled now; see the future-limits notes on `Organization` and `ScanJob` above.
- `DocumentOwner.source = ManualAssignment` is reserved but unused in MVP — a future feature could let an `Admin` `User` explicitly assign a governance owner independent of Graph-derived authorship.
- If v2's full Duplicate Detection (ADR-0005) requires cross-document comparison state (e.g., similarity clusters), that will likely need a new `DuplicateGroup` entity rather than overloading `HealthIssue`.
- Prisma schema translation of this model, including index selection (`organizationId` composite indexes are a near-certain requirement per `database-rules.md`), is deferred to the Phase 1 implementation step that actually writes the schema.
