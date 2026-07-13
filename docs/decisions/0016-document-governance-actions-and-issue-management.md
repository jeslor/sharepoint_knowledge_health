# ADR-0016: Document Governance Actions and Issue Management

Date: 2026-07-13
Status: Accepted

---

## 1. Problem Statement

Phases 1–7C built a complete *detection* pipeline: Microsoft Graph → Document
Collection → Health Scoring → `HealthIssue` generation → dashboard visibility,
now including historical trends (ADR-0015) and scan-to-scan comparison. What
does not exist anywhere in the system is a way to **act** on what's found. An
Admin can see "Employee Handbook.docx has no owner and hasn't been reviewed
in 18 months," but cannot assign someone to fix it, track that it's being
worked on, or record that it's been resolved. The product currently answers
"is my knowledge base healthy?" but not "what do I do about it, and who's
doing it?" — this ADR defines the architecture for that second question.

## 2. Context

Reviewed in full before drafting this ADR: all fifteen prior ADRs
(0001–0015), the current `HealthScore`/`HealthIssue`/`HealthSnapshot`/
`Document`/`DocumentOwner`/`User` Prisma models, the Phase 7C scan-comparison
implementation, the existing `EntraJwtGuard → TenantContextGuard →
OrganizationAccessGuard → RolesGuard` authorization chain, and the current
dashboard architecture (`apps/web/src/app/dashboard/**`).

Relevant standing decisions this ADR must build on, not re-litigate:

- **Row-level multi-tenancy** via a required `organizationId` on every
  tenant-scoped table (ADR-0001/0007) — any new entity follows this
  unconditionally.
- **`HealthScore`/`HealthIssue` are immutable, append-only, scan-produced**
  (ADR-0007): "a completed score is never edited, only superseded by a newer
  row from a later scan." This is the single most important constraint on
  everything below — it rules out attaching workflow state directly to
  `HealthIssue`.
- **The scoring engine is rule-based and deliberately not reconfigurable at
  runtime for MVP** (ADR-0002) — weights and thresholds are code constants,
  not stored per-organization.
- **Scans are the only way `HealthScore`/`HealthIssue` rows change** (ADR-0004,
  reinforced by every phase since: "no second scan execution path").
- **`DocumentOwner.source: ManualAssignment` and `ownerType: AssignedOwner`
  already exist in the schema, reserved and unused since ADR-0007**: "a
  future feature could let an Admin User explicitly assign a governance
  owner independent of Graph-derived authorship." This ADR is that future
  feature arriving.
- **`RolesGuard`/`@Roles(...)` already exists and is proven** (used by
  `ScanScheduleController`'s mutations, `SharePointSitesController`'s
  approval endpoint) — `UserRole` currently has exactly two values, `Admin`
  and `Member` (ADR-0007: "kept to two roles for MVP; not modeled as a
  many-to-many permissions system").
- **Every prior audit-trail need in this schema uses the same shape**:
  `<action>ByUserId` (nullable FK, `onDelete: SetNull`) + `<action>At`
  (nullable timestamp) — `MicrosoftTenant.consentGrantedByUserId`/
  `consentGrantedAt` (ADR-0007), `SharePointSite.approvedByUserId`/
  `approvedAt` (ADR-0014). Any new assignment/approval concept in this ADR
  reuses that exact shape rather than inventing a new one.
- **The current lifecycle** (as stated in the Phase 8 brief, confirmed
  against the actual code):

  ```
  Microsoft Graph → Document Collection → Health Scoring →
  HealthIssue generation → Dashboard visibility
  ```

  This ADR extends the lifecycle by one stage — **Dashboard visibility →
  Governance Action** — without touching anything upstream of it.

## 3. Current Limitations

Found by reading the actual implementation, not assumed:

1. **`HealthIssue` has no identity across scans.** Every scan that still
   detects the same underlying problem on the same document produces a
   *new* `HealthIssue` row tied to a *new* `HealthScore` row. There is no
   stable key for "this logical problem, over time" — today, "the missing
   owner on Employee Handbook.docx" is really a different database row
   every single scan. Nothing can be assigned, annotated, or tracked
   against a moving target like that.
2. **`DocumentOwner.syncOwner()` (`apps/worker/src/queue/document-collector.processor.ts:207-223`)
   unconditionally deletes *every* `DocumentOwner` row for a document on
   every rescan**, regardless of `source`, then recreates at most one row
   from `item.createdBy?.user` (Graph author only). This is a real,
   load-bearing bug for this ADR's purposes: if a manual-assignment feature
   were built on top of `DocumentOwner` as it stands today, the very next
   scheduled or manual scan would silently delete the assignment. This must
   be fixed as a prerequisite of (not a side effect of) shipping manual
   ownership assignment — flagged explicitly in Risks and Implementation
   Phases below.
3. **`hasReviewDate` is hardcoded to `false`** (`document-collector.processor.ts:277`,
   with its own code comment: *"Graph's driveItem endpoint has no native
   'review date'... hasReviewDate is always false until that's built, so
   every document currently reports a ReviewStatus issue. This is a real
   gap, not a placeholder oversight."*). Every document in the system today
   fails the ReviewStatus criterion unconditionally — there is currently
   zero real review-date signal anywhere in the product.
4. **Only two roles exist** (`Admin`, `Member`), with a hard binary between
   "full organizational admin" (scans, tenant connections, site approval,
   scheduling) and "read-only." There is no tier for someone who should be
   able to triage and resolve governance issues without also being able to
   connect Microsoft tenants or manage billing-adjacent settings.
5. **No resource-scoped (per-document) authorization exists anywhere in this
   codebase.** Every existing authorization check is organization-scoped
   (`OrganizationAccessGuard`) or role-scoped (`RolesGuard`) — nothing today
   asks "does this specific user have a relationship to this specific
   document." Noted here as a factual gap, not as something this ADR closes
   — §4.6 deliberately keeps permissions purely role-based and does not
   introduce a resource-scoped check for v1.

## 4. Considered Options

### 4.1 Issue lifecycle: keep `HealthIssue` as-is, or add a governance entity

**Option A — `HealthIssue` remains calculated data only, no new entity.**
Workflow fields (`status`, `assignedUserId`, `resolutionNotes`) would have to
be bolted directly onto `HealthIssue`. Rejected: it would make `HealthIssue`
mutable, directly violating ADR-0007's stated invariant ("immutable... never
updated after creation"), and it does nothing to solve Limitation 1 — a
`HealthIssue` row still has no identity beyond one scan, so "assign this
issue" would silently stop pointing at anything the moment the next scan
runs and generates a fresh row for the same underlying problem.

**Option B — a separate `GovernanceIssue` entity**, as sketched in the Phase
8 brief. Owns workflow state independently of the scoring pipeline.
`HealthIssue` keeps doing exactly what it does today, forever — a raw,
disposable, scan-instance-scoped finding. `GovernanceIssue` is keyed by
`(documentId, issueType)`, not by a specific `HealthIssue` row, precisely
*because* a specific row has no cross-scan identity — a `GovernanceIssue` is
about the durable, real-world problem, not any one scan's observation of it.

**Decision: Option B**, with one clarification the "A vs. B" framing
slightly obscures: this isn't "A *or* B," it's both, cleanly separated by
responsibility. `HealthIssue` stays exactly Option A (calculated, immutable,
scan-owned). `GovernanceIssue` is new, entirely human/API-owned, and the
worker never writes to it — this is the same "one execution path per
concern" discipline every prior scan-adjacent ADR has enforced.

- **Data ownership**: `HealthIssue` is written only by `apps/worker`
  (scoring pipeline). `GovernanceIssue` is written only by `apps/api`
  (governance actions) — the worker never creates, updates, or resolves a
  `GovernanceIssue`, the same boundary that already separates "worker
  computes" from "api serves" everywhere else in this codebase.
- **Historical behavior**: `GovernanceIssue` rows are never hard-deleted,
  matching `SharePointSite`'s status-transition-not-delete precedent
  (ADR-0014) — a resolved issue remains a permanent governance record.
- **Impact on `HealthIssue`**: none. No schema change, no new relation
  required *from* `HealthIssue`'s side. `GovernanceIssue` references
  `documentId` + `issueType` (reusing the existing `HealthIssueCriterion`
  enum — no new taxonomy), not a specific `HealthIssue.id`.
- **Creation trigger**: lazy, not automatic. A `GovernanceIssue` is created
  only when a human takes a first governance action (assign, or explicitly
  "start tracking") on a given `(documentId, issueType)` pair — not
  automatically for every `HealthIssue` every scan produces. Auto-creating
  one per `HealthIssue` per scan would mean most rows are never touched by
  anyone (most issues are low-severity and self-resolve at the next scan)
  — pure bloat with no workflow value. This mirrors how `ScanSchedule` in
  Phase 7B is also opt-in per organization, not auto-created.
- **Reconciling with future scans**: the worker never touches
  `GovernanceIssue`, in either direction — it doesn't auto-close one when
  the condition improves, and it doesn't reopen one when it recurs. Instead,
  whether the underlying `HealthIssue` is *still present* in the document's
  current scan is computed at **read time** as a derived flag (a join
  against `Document.currentHealthScore.healthIssues`), never stored. This
  gives humans the signal they need ("still detected as of the latest
  scan") without the worker ever writing governance state — see §4.4 for
  why this also answers the health-score-interaction question cleanly.

#### `HealthIssue` → `GovernanceIssue`: confirmed roles and relationship

Restated precisely, as approved:

- **`HealthIssue`**: generated by scans, immutable, **historical evidence**.
  Never assigned, never carries a status, never referenced by a foreign key
  from `GovernanceIssue`. Every scan that still detects a problem produces
  another one — that's a feature (a complete, honest history of every
  scan's findings), not something to be tidied up by this ADR.
- **`GovernanceIssue`**: **user workflow state** — assignment, status,
  resolution notes. Written only by `apps/api`, never by the worker.

**The relationship is a logical key match, not a physical foreign key.**
`GovernanceIssue` is keyed by `(documentId, issueType)` — the same pair
every `HealthIssue` for that problem, across every scan, shares. There is
deliberately no `GovernanceIssue.healthIssueId` column pointing at one
specific `HealthIssue` row.

- **When is a `GovernanceIssue` created?** Lazily — on the first human
  action (open/assign/track) against a given `(documentId, issueType)`
  pair, per §4.1 above. Never auto-created by a scan.
- **Do multiple `HealthIssue`s map to one `GovernanceIssue`?** Yes, by
  design, and this is exactly *why* the key is `(documentId, issueType)`
  rather than a specific row: every scan that continues to detect the same
  problem produces one more `HealthIssue` row, and all of them — past,
  present, and future, for as long as the problem is periodically
  redetected — correspond to the same single `GovernanceIssue` workflow
  thread. This mapping is never materialized as a list or a join table; it
  is resolved on demand, by matching `(documentId, issueType)` against
  whichever `HealthIssue`s exist at query time. Avoiding a stored
  one-to-many join is deliberate: it would grow unboundedly with every
  scan and answer a question ("which specific past `HealthIssue` rows does
  this relate to") nothing in this ADR's requirements actually needs.
- **What happens after the document improves?** "Improves" means the next
  scan no longer generates a `HealthIssue` for that `(documentId,
  issueType)` pair. Nothing about the `GovernanceIssue` row changes
  automatically — its `status` stays whatever a human last set it to. What
  changes is the **derived** "still detected in latest scan" read-time flag
  (§4.1), which flips to "not detected." A `GovernanceIssue` still `OPEN`
  or `IN_PROGRESS` with "not detected in latest scan" is a strong signal
  the dashboard can surface (e.g., "this may already be resolved — confirm
  and close?"), but the actual transition to `RESOLVED` remains a deliberate
  human action, never automatic — consistent with §4.5's "100% human-driven,
  auditable" state-transition rule.

### 4.2 Document ownership workflow

Two genuinely distinct concepts the Phase 8 brief's "ownership" language
covers, kept separate rather than conflated:

- **Document ownership** (who is accountable for this document,
  long-term) — this already has a home: `DocumentOwner`, with
  `source: ManualAssignment` reserved since ADR-0007 and never implemented.
- **Issue assignment** (who is actively working this specific problem,
  right now) — this is `GovernanceIssue.assignedUserId`, new in this ADR.

These are related but independent: the person assigned to fix a
missing-review-date issue on a document doesn't have to be that document's
long-term owner (e.g., an IT admin clearing a backlog), and a document's
owner doesn't automatically get every issue on their document auto-assigned
to them (assignment is still an explicit action).

- **Can users assign document owners?** Yes — exactly the feature
  `DocumentOwner.source: ManualAssignment` was reserved for. No schema
  change is required for the enum values themselves; what's missing is (a)
  an API surface to create/update these rows, and (b) fixing Limitation 2
  so a manual assignment survives the next rescan.
- **Only inside the application, or sync back to SharePoint?** Application
  only, for v1. Writing an owner back into a SharePoint custom column would
  require `Sites.ReadWrite.All`, a write scope ADR-0003 explicitly declined
  to request ("no such feature exists in MVP scope... request the
  additional write scope as a separate, explicitly-justified consent step
  at that time"). This ADR does not create that justification — see Scope
  Discipline.
- **Should assignments require permissions?** Yes — see §4.5. Only `Admin`
  and the new `GovernanceManager` role can assign document ownership; a
  document's existing owner cannot reassign themselves to a different
  document.
- **How does ownership affect future health scores?** It already would,
  automatically, with zero scoring-engine changes — see §4.4. The
  `Ownership` scoring criterion already reads `DocumentOwner` rows and
  checks whether the owner's `email` matches an `Active` `User`
  (`document-collector.processor.ts:247-249`). A manually assigned owner
  who is an existing platform `User` satisfies this exact, already-built
  signal the moment the next scan runs — no scoring rule needs to know
  "manual" vs. "Graph-derived" ownership exists.

#### Ownership source precedence, conflict resolution, and rescan behavior

Confirmed against `packages/scoring/src/rules/ownership.ts`: `scoreOwnership`
already evaluates the **full set** of a document's `DocumentOwner` rows
permissively — score is 0 only if *no* owner is identifiable, and the
inactive-owner penalty only applies if *every* resolved owner is inactive.
In other words, one good owner (from either source) already outweighs one
bad owner today, with zero scoring-rule change. This directly shapes the
precedence/conflict answers below: precedence is a **display** concern, not
a **scoring** concern.

- **Source precedence (display only)**: when the UI needs to show a single
  "primary owner" (e.g., the document detail page's current
  `primaryOwner = owners[0]` in `documents.service.ts`, which today has no
  defined ordering), a `source: ManualAssignment` row takes precedence over
  a `source: GraphMetadata` row — a human's deliberate assignment outranks
  an inferred one for display purposes. This is purely a read-time sort
  (`ManualAssignment` first), not a data change — both rows continue to
  exist and both continue to feed scoring equally.
- **Conflict resolution**: "conflict" in the scoring sense mostly doesn't
  arise, by the existing rule's own design — a stale/inactive
  `GraphMetadata` author alongside an active `ManualAssignment` owner
  already resolves to a healthy score today (one active resolved owner is
  enough), with no change required. The only place a real conflict
  question exists is display ("who do we call *the* owner") — resolved by
  the precedence rule above. No document is prevented from having more than
  one `DocumentOwner` row of either source simultaneously (co-owners,
  or an outdated author alongside a corrected manual assignment) — the
  schema already supports "zero, one, or multiple" per ADR-0007, and this
  ADR does not add a uniqueness constraint that would force a choice.
- **Rescan behavior (the required fix)**: `syncOwner()` is changed from
  "delete every `DocumentOwner` row for this document, then recreate one
  from Graph" to **"delete/recreate only rows where `source:
  GraphMetadata`; never read, delete, or recreate rows where `source:
  ManualAssignment`."** Concretely: the existing-owners query gains a
  `source: 'GraphMetadata'` filter before the delete loop, and the
  recreated row is explicitly created with `source: 'GraphMetadata'`
  (already true today, now made a hard invariant rather than an
  accident of there being only one code path). A `ManualAssignment` row is
  therefore **only** ever created, updated, or deleted by an explicit
  governance API call (Phase 8B) — the worker's write path and the
  governance API's write path are partitioned by `source`, never overlap,
  and never race. This is the literal implementation of "manual assignments
  must survive future scans" and "a rescan must only update/remove
  Graph-derived ownership records."

### 4.3 Review lifecycle

- **Should review dates come from SharePoint metadata?** Not for v1 — they
  can't. Reading a custom SharePoint list column requires the Graph List
  Items API, which `packages/graph-client` does not expose today (ADR-0013
  §8 lists only `listSites`/`listDrives`/`listDocuments`/`getSite`/
  `getDrive`/`getDocument` — no list-item surface) and which this ADR's
  Scope Discipline explicitly defers (§9/§10 of the brief).
- **Should the platform maintain its own review schedule?** Yes — this is
  the only way to close Limitation 3 without the Graph List API. Proposed:
  `Document.nextReviewDueAt: DateTime?` plus a `reviewDateSource` enum
  (`Manual`, `GraphMetadata`) — deliberately the same
  reserved-but-unused-until-later shape as `DocumentOwner.source`, so the
  eventual Graph List API integration is an additive data-source change,
  not a redesign, exactly the upgrade path ADR-0002 already established for
  the duplication criterion (ADR-0005) and the pattern ADR-0007 anticipated
  for `DocumentOwner`.
- **Upcoming / overdue reviews**: derived entirely from
  `nextReviewDueAt` compared against `now()` at read time — no new status
  field, no stored "is this overdue" boolean that could drift out of sync.
  An index on `(organizationId, nextReviewDueAt)` supports this efficiently,
  the same shape as `ScanSchedule`'s `[enabled, nextRunAt]` index from
  Phase 7B.
- **Interaction with future Graph List API support**: when that lands, a
  scan could set `nextReviewDueAt` with `reviewDateSource: GraphMetadata`.
  Whether a Graph-sourced value should ever overwrite a Manual one is an
  open question explicitly left to that future ADR — not decided here.

### 4.4 Health score interaction: A (immediate), B (next scan), or C (both)?

**Recommended: B for the score itself, with a governance-layer affordance
that gives the *feeling* of C without actually being C.**

Option A (the score improves immediately when an issue is resolved) is not
compatible with the standing architecture without a real violation: it would
require either mutating an immutable `HealthScore` row (contradicts
ADR-0007 directly) or computing a score outside of a scan (a second,
parallel scoring execution path — exactly what every phase since ADR-0004
has treated as a hard boundary). Neither is acceptable, and this ADR does
not propose changing that.

So the honest, architecture-respecting answer is **B**: resolving a
`GovernanceIssue`, or assigning a document owner, never touches
`HealthScore`/`HealthIssue`. It only changes *inputs*
(`DocumentOwner`, `Document.nextReviewDueAt`) that the **next scan's**
scoring pass reads. The score updates exactly when it always has — when a
scan runs.

What *can* update immediately, without touching scoring at all, is the
`GovernanceIssue`'s own workflow `status` — because that's tracking human
progress, a genuinely different fact from "what does the scoring engine
currently measure." Combined with the derived "still detected in latest
scan" read-time flag from §4.1, the dashboard can honestly show, the instant
a human acts: *"Marked Resolved by Sarah — last scan (3 days ago) still
shows this issue; re-scan to confirm."* That's real, immediate, truthful
feedback on the thing that actually changed (a person's work status),
without ever faking or short-circuiting the thing that hasn't changed yet
(the measured score).

**Tradeoff worth stating plainly**: under a Weekly `ScanSchedule` (Phase
7B), that "pending confirmation" state could persist up to a week. No new
mitigation is needed — `POST /organizations/:id/scans` (manual trigger)
already exists and already lets an Admin force an earlier confirmation;
this ADR doesn't need to invent anything new to cover that gap.

### 4.5 Resolution workflow: full 5-state machine, or simpler? (Confirmed, approved as-is)

The brief's example (`OPEN → ASSIGNED → IN_PROGRESS → RESOLVED → VERIFIED`)
is evaluated and **rejected as unnecessary complexity for v1**, in favor of:

```
OPEN ⇄ IN_PROGRESS ⇄ RESOLVED
         ↑_______________|
         (manual reopen)
```

Two simplifications, each removing a state by re-modeling what it was
actually trying to express:

- **`ASSIGNED` is not a status — it's an orthogonal field.**
  `assignedUserId` (nullable) can be set or cleared independent of
  `status`. An issue can be `OPEN` and unassigned, `OPEN` and assigned,
  `IN_PROGRESS`, etc. — this is how every mainstream issue tracker (Jira,
  Linear, GitHub Issues) actually models assignment, and collapsing it into
  the status enum would mean "assigned but not yet started" and "assigned
  and actively being worked" can't both be represented without adding
  *more* states, not fewer.
- **`VERIFIED` is mostly already delivered by the §4.1 derived flag.** The
  reason a 5-state machine wants a distinct verification step is to
  distinguish "a human says it's fixed" from "we confirmed it's actually
  fixed." The read-time "still detected in latest scan" signal on a
  `RESOLVED` issue gives exactly that distinction — for free, without a
  status value, a verification action, or a second API endpoint. A human
  looking at a `RESOLVED` issue with "confirmed clear as of last scan"
  attached already has what `VERIFIED` was reaching for.

Reopening is manual only — `RESOLVED → OPEN` is a human action (same
permission as resolving), never automatic. The worker never reopens a
`GovernanceIssue`, for the same reason it never auto-resolves one: keeping
every `GovernanceIssue` state transition 100% human-driven and auditable
is what makes it trustworthy as a governance *record*, not just a cache of
what the scanner currently thinks.

**Confirmed on review**: the 3-state workflow (`OPEN`/`IN_PROGRESS`/
`RESOLVED`) is approved as the v1 design. "Still detected in latest scan"
remains a derived, read-time flag, never stored state. `VERIFIED` is not
added — it stays a deliberately rejected v1 state, to be reconsidered only
if a concrete future workflow requirement demonstrates the derived flag is
insufficient, not added speculatively now.

### 4.6 Permissions and roles

Evaluated the brief's four-role sketch (`Organization Admin`, `Governance
Manager`, `Document Owner`, `Viewer`) against "avoid unnecessary role
complexity":

- **`Viewer` is not a new role — it's the existing `Member`.** ADR-0007
  already defines `Member` as "read-only dashboard access." Nothing in this
  ADR needs a *second* read-only tier.
- **`Governance Manager` is a real, structurally distinct gap.** Today
  there is no tier between "can do everything Admin can" and "read-only" —
  someone who should triage and resolve governance issues but shouldn't
  necessarily manage Microsoft tenant connections, scan schedules, or user
  approvals has no home in the current two-role model. This is the one
  genuinely new **organization-level** role this ADR proposes.
- **`Document Owner` is not a role, and is explicitly *not* modeled as a
  permission tier in v1.** Whether someone is "the owner" is a fact about a
  specific `(User, Document)` pair (`DocumentOwner.assignedUserId`, once
  §4.2 ships), not a fact about organizational standing — but this ADR
  **does not** turn that relationship into an authorization exception.
  Reviewed and rejected: a resource-scoped "the document's own owner can
  act on its issues" carve-out was considered in an earlier draft and
  explicitly walked back per "avoid introducing document-level permissions
  unless required" — no concrete requirement in this brief needs it, it
  would be this codebase's first resource-scoped (non-role) authorization
  check (a genuinely new *mechanism*, not just a new value), and Limitation
  5's absence of any such mechanism today is left exactly as it is. If a
  real future need for owner-scoped self-service emerges, it's a
  deliberate, separately-justified v2 addition — not something to build
  speculatively now.

**Decision**: `UserRole` gains exactly one value — `Admin | GovernanceManager
| Member` — no other change to the authorization model. `Admin` is a strict
superset of `GovernanceManager`'s governance capabilities (consistent with
`Admin` already being a superset of every other privileged action in this
system — tenant connection, site approval, scheduling). `Member` keeps its
existing, unmodified behavior: read-only.

| Action | Admin | GovernanceManager | Member |
|---|---|---|---|
| View issues | ✅ | ✅ | ✅ |
| Assign issues | ✅ | ✅ | ❌ |
| Resolve/reopen issues | ✅ | ✅ | ❌ |
| Assign document ownership | ✅ | ✅ | ❌ |
| Manage review workflows (set/update review dates) | ✅ | ✅ | ❌ |
| Manage governance settings (future) / tenant connections / scan scheduling / user approval | ✅ | ❌ | ❌ |

Concretely: **`Admin`** retains everything it already does today (full
organization management — Microsoft tenant connections, site approval,
scan scheduling, user approval) with no change. **`GovernanceManager`** is
scoped precisely to governance: manage `GovernanceIssue`s (view, assign,
resolve, reopen), assign document owners, manage review workflows (set/
update `Document.nextReviewDueAt`) — nothing outside that surface.
**`Member`** is unchanged from its existing, already-shipped behavior.

"View issues" stays unrestricted by role (any `Active` user in the
organization), matching every existing read endpoint in this API
(`health-summary`, `documents`, `scans` — none of them carry a `@Roles(...)`
restriction today; only mutations do).

## 5. Recommended Architecture

Two new concerns, cleanly layered onto the existing pipeline without
touching it:

```
Microsoft Graph → Document Collection → Health Scoring → HealthIssue generation
                                                                  │
                                                                  ▼
                                                        Dashboard visibility
                                                                  │
                                              (human decides to act, lazily)
                                                                  ▼
                                                          GovernanceIssue
                                                    (assign / status / notes)
                                                                  │
                                        (inputs change: DocumentOwner, review date)
                                                                  ▼
                                                   next ScanJob re-scores normally
```

- `apps/worker` is entirely unmodified in its scoring/issue-generation
  responsibilities (Limitation 3's `hasReviewDate` fix is the one exception
  — see Risks — and is an *input* change, not a rule change).
- `apps/worker`'s `syncOwner()` gets one required, narrow fix: only
  delete/recreate `DocumentOwner` rows with `source: GraphMetadata`; never
  touch `source: ManualAssignment` rows. This is a bug fix prerequisite for
  this ADR's ownership feature, not new governance logic in the worker.
- All new governance state (`GovernanceIssue`, review dates, manual
  ownership) is written exclusively through `apps/api`, following the exact
  module-per-resource convention already established (`health-summary`,
  `scans`, `scan-schedule`, `health-trends`).
- `apps/web` gains one new top-level surface (Governance Dashboard) and
  extends one existing surface (the document detail page) — see §8.

## 6. Data Model Proposal

All additive. No existing table is altered destructively; no existing
column is removed or renamed.

```prisma
enum UserRole {
  Admin
  GovernanceManager   // new
  Member
}

enum GovernanceIssueStatus {
  Open
  InProgress
  Resolved
}

model GovernanceIssue {
  id              String                @id @default(cuid())
  organizationId  String
  documentId      String
  issueType       HealthIssueCriterion  // reuses the existing 6-value enum — no new taxonomy
  severity        HealthIssueSeverity   // snapshotted from the triggering HealthIssue at creation; not auto-updated by later scans (human-owned once opened, see §4.1)
  status          GovernanceIssueStatus @default(Open)
  assignedUserId  String?
  resolutionNotes String?
  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt
  resolvedAt      DateTime?

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  document     Document     @relation(fields: [documentId], references: [id], onDelete: Cascade)
  assignedUser User?        @relation("GovernanceIssueAssignedTo", fields: [assignedUserId], references: [id], onDelete: SetNull)

  // One durable workflow thread per document+problem-type, reused across
  // resolve/reopen cycles rather than a new row per cycle — a deliberate
  // v1 simplification (see Risks: no per-transition audit log yet).
  @@unique([documentId, issueType])
  @@index([organizationId, status])
  @@index([assignedUserId])
}

enum DocumentReviewDateSource {
  Manual
  GraphMetadata   // reserved, unused until a future Graph List Items API ADR
}

model Document {
  // ...existing fields, unchanged...
  nextReviewDueAt  DateTime?
  reviewDateSource DocumentReviewDateSource @default(Manual)

  governanceIssues GovernanceIssue[]

  @@index([organizationId, nextReviewDueAt])   // supports overdue/upcoming queries
}

model DocumentOwner {
  // ...existing fields, unchanged...
  assignedByUserId String?    // new — only set when source: ManualAssignment
  assignedAt       DateTime?  // new — same shape as SharePointSite.approvedAt (ADR-0014)

  assignedByUser User? @relation("DocumentOwnerAssignedBy", fields: [assignedByUserId], references: [id], onDelete: SetNull)
}

model User {
  // ...existing fields, unchanged...
  assignedGovernanceIssues GovernanceIssue[] @relation("GovernanceIssueAssignedTo")
  assignedDocumentOwners   DocumentOwner[]   @relation("DocumentOwnerAssignedBy")
}
```

Tenant isolation: `GovernanceIssue.organizationId` is required and
denormalized, following ADR-0001/0007 exactly — no exception, no new
pattern.

## 7. API Proposal

Proposed shapes only — per the brief's own instruction, **not finalized**
until implementation. All routes follow the existing
`EntraJwtGuard → TenantContextGuard → OrganizationAccessGuard` chain;
mutation routes additionally carry `RolesGuard` + `@Roles('Admin',
'GovernanceManager')` per §4.6's table — purely role-based, no
resource-scoped check, matching every other mutation endpoint in this API
today.

**Issues**

```
GET   /organizations/:id/issues                    list, filterable by status/severity/assignedUserId/documentId, paginated (mirrors document-health's existing pattern)
GET   /organizations/:id/issues/:issueId
PATCH /organizations/:id/issues/:issueId            status, resolutionNotes, reopen
POST  /organizations/:id/documents/:documentId/issues   opens a GovernanceIssue for a (documentId, issueType) pair — the lazy-creation moment (§4.1)
```

**Assignment**

```
POST  /organizations/:id/issues/:issueId/assign     { assignedUserId: string | null }
```

Kept as its own endpoint (matching the brief's sketch) rather than folded
into `PATCH`, since assignment is arguably its own audit-worthy action
distinct from a status change — flagged as an open implementation-time
question, not decided here.

**Document ownership**

```
GET    /organizations/:id/documents/:documentId/governance   aggregate view: score + issues + GovernanceIssues + ownership + review status
POST   /organizations/:id/documents/:documentId/owners       assign (source: ManualAssignment)
DELETE /organizations/:id/documents/:documentId/owners/:ownerId   remove a manual assignment only (GraphMetadata-sourced rows are worker-owned, never deletable via this route)
```

**Review lifecycle**

```
PATCH /organizations/:id/documents/:documentId/review   { nextReviewDueAt }
GET   /organizations/:id/reviews?status=overdue|upcoming
```

**Governance summary**

```
GET /organizations/:id/governance-summary   open/critical/assigned/resolved counts, overdue review count — mirrors health-summary's existing shape
```

## 8. Frontend Experience

- **Governance Dashboard** (`/dashboard/governance`, new nav item) —
  summary cards (open, critical, assigned-to-me, resolved this period),
  mirroring `OverviewCards`/`TrendCards`'s already-established card
  pattern; a filterable, paginated issue list mirroring
  `DocumentHealthTable`'s existing filter/sort/pagination pattern.
- **Issue Detail** (`/dashboard/governance/issues/:issueId`) — mirrors the
  just-built scan detail page shape (metadata block + status/assignment
  controls + resolution notes + the derived "still detected in latest
  scan" indicator from §4.1).
- **Document Governance View** — not a new page. Extends the *existing*
  document detail page (`/dashboard/documents/[documentId]`, already
  showing score, issues, and score history as of Phase 6/7C) with new
  sections: ownership (current owner + assign control), review status (due
  date + set control), and the document's own `GovernanceIssue` list. This
  follows the same "extend an existing surface" precedent Phase 7B used
  when it added `ScanScheduleSettings` to the existing `/dashboard/scans`
  page rather than inventing a new route.

## 9. Integration Considerations (not designed in detail, not implemented now)

- **Microsoft Graph List Items API**: the eventual real source for
  `reviewDateSource: GraphMetadata` and possibly other SharePoint-native
  governance columns. `packages/graph-client`'s ADR-0013 architecture
  (DTO/domain separation, product-agnostic public API) already anticipates
  extension here without rework.
- **SharePoint metadata columns / write-back**: a plausible future
  extension (e.g., writing the health score into a custom SharePoint
  column) — requires the `Sites.ReadWrite.All` scope ADR-0003 explicitly
  declined to request; would need its own ADR and its own justified consent
  step, exactly as ADR-0003 already anticipated.
- **Microsoft Purview**: compliance/retention-label alignment could inform
  a future scoring criterion or `GovernanceIssue` type; no design implied
  here.
- **Copilot readiness**: "is this document fit to be surfaced to Copilot"
  is close to a rebranding of this product's existing mission — worth
  noting as a future positioning angle for the composite score, not an
  architecture change.

## 10. Scope Discipline

Explicitly **not** designed or implied by this ADR: AI/LLM recommendations,
RAG, notifications (email/Teams/in-app), automatic document editing, or any
SharePoint write-back. Every one of those would need its own separate ADR
and its own explicit justification, consistent with how ADR-0003 already
treats write-scope requests and how ADR-0015 §6 already treats
notifications (an unimplemented integration *point*, never a delivered
feature).

**One deliberate near-exception, flagged for transparency**: §4.3 proposes
that `hasReviewDate` stop being hardcoded `false` and instead read
`Document.nextReviewDueAt`. The scoring *rule* itself
(`scoreReviewStatus` in `packages/scoring`) does not change at all — only
the value its caller passes in changes, from a constant to a real field.
Given how consistently "do not modify scoring logic" has been treated as a
hard boundary in every phase since ADR-0002, this is called out explicitly
here rather than silently bundled into governance work, and is recommended
as its own small ADR-0002 amendment step (see §12) — not something this ADR
authorizes on its own.

## 11. Migration Strategy

All changes are additive; no destructive migration, no backfill required
(consistent with every migration in this project so far — pre-launch, no
production data):

- `UserRole` gains `GovernanceManager` — additive enum value; existing
  `Admin`/`Member` rows unaffected.
- `GovernanceIssue` is an entirely new table, empty at migration time.
- `Document.nextReviewDueAt` (nullable) / `reviewDateSource`
  (defaulted `Manual`) — existing `Document` rows get `nextReviewDueAt:
  null`, which the scoring input should treat identically to today's
  hardcoded-`false` case (no scoring cliff at migration time — every
  document simply continues failing ReviewStatus until someone sets a real
  date, exactly the same outcome as today, just for a real reason instead
  of a stub).
- `DocumentOwner.assignedByUserId` / `assignedAt` — nullable additive
  columns.

## 12. Risks

1. **The `syncOwner()` rescan-wipe bug (Limitation 2) must be fixed as a
   hard prerequisite**, not a nice-to-have — shipping manual ownership
   assignment without it means every scan silently destroys an Admin's
   work. Highest-priority implementation risk in this ADR.
2. **`GovernanceIssue` can drift from reality** — a human marks something
   Resolved while the condition persists, or vice versa. Mitigated, not
   eliminated, by the derived "still detected in latest scan" read-time
   signal (§4.1) — an accepted, standard limitation of any workflow layered
   on top of periodic (not real-time) detection.
3. **The `hasReviewDate` input change (§10) touches worker call-site code**
   even though the scoring *rule* doesn't change — needs its own explicit
   review against the "do not modify scoring logic" discipline this
   codebase has otherwise held to strictly; recommended as a distinct,
   separately-reviewed ADR-0002 amendment rather than folded silently into
   governance work.
4. **Row growth is bounded by design** (lazy `GovernanceIssue` creation,
   §4.1) but that assumption should be confirmed against real usage once
   built, not just asserted here.
5. **Confirmation lag under a Weekly `ScanSchedule`** — a Resolved issue
   may show "pending confirmation" for up to a week. No new mitigation
   required; the existing manual scan trigger already covers it.
6. **`syncOwner()`'s source-scoped fix (§4.2) must be tested precisely** —
   the risk isn't "resource-scoped authorization" (explicitly rejected,
   §4.6) but a narrower, real one: a regression that widens the delete
   filter back to "all owners" (reintroducing Limitation 2) or narrows it
   incorrectly (e.g., never updating `GraphMetadata` rows at all) would be
   silent — nothing fails loudly, ownership just quietly stops reflecting
   reality. Needs an explicit test asserting a `ManualAssignment` row
   survives a rescan that changes the Graph-derived author.

## 13. Implementation Phases (approved sequencing)

1. **Phase 8A — Foundation fixes**: no new API surface, no frontend — pure
   data-layer and worker-correctness groundwork, so every later phase
   builds on already-safe primitives:
   - **Ownership persistence model**: the `syncOwner()` source-scoping fix
     (§4.2) — the hard prerequisite (Risk 1) — plus the additive
     `DocumentOwner.assignedByUserId`/`assignedAt` columns.
   - **`GovernanceIssue` foundation**: the schema (`GovernanceIssue` model,
     `GovernanceIssueStatus` enum, `UserRole.GovernanceManager`) and its
     `packages/database` repository — no assign/resolve API yet (that's
     8B).
   - **Review metadata foundation**: `Document.nextReviewDueAt` /
     `reviewDateSource` schema only. **Not** wired into
     `hasReviewDate` — that requires the separate ADR-0002 amendment
     (below), which is explicitly not part of Phase 8.
2. **Phase 8B — Issue management workflow**: the full `GovernanceIssue`
   API — list/get/open/`PATCH` (status, notes, reopen)/assign — plus the
   document-ownership assignment API (`POST`/`DELETE .../owners`), now safe
   to build on top of 8A's fix. `RolesGuard` + `@Roles('Admin',
   'GovernanceManager')` throughout, per §4.6.
3. **Phase 8C — Governance dashboard**: the frontend — Governance Dashboard,
   Issue Detail page, and the extended Document Governance View (§8) —
   consuming everything 8A/8B built.
4. **Phase 8D — Advanced governance workflows**: whatever remains once the
   core loop (detect → track → resolve) is live and in use — e.g., the
   overdue/upcoming review views and `GET .../governance-summary`
   endpoint from §7, and any refinements the first three phases' real usage
   surfaces. Deliberately left open rather than over-specified this far
   ahead, consistent with how ADR-0015's own phased rollout treated its
   later phases.

## 14. Implementation Notes (Phase 8C — Governance Audit Trail)

Phase 8C added the audit trail this ADR's original data model didn't yet
include. No architectural intent from §4–§13 above changed; this section
documents what was actually built.

**`GovernanceActivity` model** — one immutable row per recorded governance
action:

```prisma
enum GovernanceActivityType {
  IssueCreated
  IssueAssigned
  AssigneeChanged
  StatusChanged
  ResolutionNoteUpdated
  OwnerAssigned
  OwnerRemoved
  IssueReopened
  IssueResolved
}

model GovernanceActivity {
  id                String                 @id @default(cuid())
  organizationId    String
  governanceIssueId String?
  documentId        String
  actorUserId       String
  activityType      GovernanceActivityType
  previousValue     String?
  newValue          String?
  metadata          Json?
  createdAt         DateTime               @default(now())
}
```

PascalCase enum values, matching this schema's existing convention — the
brief's own SCREAMING_SNAKE_CASE examples (`ISSUE_CREATED`, etc.) are
translated the same way every prior phase has translated illustrative
naming onto this codebase's real conventions (e.g. Phase 7B's
`OPEN`/`IN_PROGRESS` sketch became `Open`/`InProgress`).

**Why append-only, and how it's enforced**: `GovernanceActivityRepository`
exposes only `findMany`/`findFirstById`/`count`/`create` — there is no
`updateById` or `deleteById` method to call, even by mistake. This is the
same discipline ADR-0013 §8 already established for
`packages/graph-client`'s read-only public API ("read-only is enforced by
the public API shape itself, not just by the granted permissions") —
applied here to writes instead of reads. No database trigger or rule was
added; this codebase has never used that mechanism anywhere else
(`HealthScore`/`HealthIssue`'s immutability, ADR-0007, is enforced the
same repository-shape way), and introducing one here would be a new,
unjustified pattern. An audit trail is only trustworthy if it cannot be
rewritten after the fact — that's the entire reason it's append-only, not
a stylistic preference.

**Relationship with `GovernanceIssue`**: a logical key, not a stored join.
`governanceIssueId` is set on every issue-lifecycle activity type
(`IssueCreated`, `IssueAssigned`, `AssigneeChanged`, `StatusChanged`,
`ResolutionNoteUpdated`, `IssueReopened`, `IssueResolved`) and left `null`
on the two document-ownership activity types (`OwnerAssigned`,
`OwnerRemoved`), which aren't tied to any specific `GovernanceIssue` — a
manual ownership assignment can happen on a document with zero open
issues. `documentId` is required on every row instead, since every
governance action, issue-related or not, happens in the context of
exactly one document. Many `GovernanceActivity` rows accumulate against
one `GovernanceIssue` over its lifetime (one scan didn't produce this
history — a sequence of human actions did); there is no cap and no
archival step, matching the "never delete" requirement directly.

**Centralized recording**: a single `GovernanceActivityService.record()`
(new, shared module `GovernanceActivityModule`) is the only write path,
called from `GovernanceIssuesService` (create/update) and
`DocumentsService` (owner assign/remove) — never from a controller
directly, and never left to a call site to remember. `previousValue`/
`newValue` are resolved to display-ready strings (e.g. an assignee's
`displayName`) at write time, not raw ids — this is what keeps every read
path (list, paginate, filter) a single query with no secondary batch
lookup just to render human-readable text, the same "resolve once, read
cheaply" tradeoff ADR-0015 §3 already made for `HealthSnapshot`.

**Status-edge mapping**: `StatusChanged`/`IssueResolved`/`IssueReopened`
map exactly onto the 3-edge transition cycle §4.5 already defined
(`Open→InProgress` = `StatusChanged`; `InProgress→Resolved` =
`IssueResolved`; `Resolved→Open` = `IssueReopened`) — no new states, just
naming the three existing edges individually so a reader scanning the
activity feed doesn't have to infer resolution/reopening from a generic
"status changed" line.

## ADRs Requiring Amendment

- **ADR-0002** (Document Health Score Algorithm) — a **proposed amendment
  has been drafted** (appended to `docs/decisions/0002-document-health-score-algorithm.md`,
  its own status marked `Proposed`, pending separate review/approval) —
  covering current behavior, why `hasReviewDate: false` is inaccurate,
  future review-date sources, and scoring impact, exactly as requested.
  **Not implemented as part of Phase 8** — Phase 8A's review-metadata
  foundation is schema-only and does not wire into scoring; that wiring
  only happens once the ADR-0002 amendment itself is separately accepted.
- **ADR-0007** (Domain Model) — its "Future Considerations" already
  anticipated both `DocumentOwner.source = ManualAssignment` ("reserved but
  unused in MVP") and RBAC expansion ("a simple additive enum-value
  migration when needed") — this ADR is the fulfillment of both, not a
  contradiction. Worth a short implementation-note addition once Phase 8A
  ships, in the same style as ADR-0009's and ADR-0011's own "Implementation
  note" / "Amendment" sections, rather than reopening ADR-0007 itself.
- **No other ADR requires a status or decision change.** Everything else
  this ADR relies on (tenant isolation, the auth trust model, the guard
  chain, the monorepo/package boundaries) is used exactly as already
  decided.

Status: **Accepted** (2026-07-13, after review incorporating: explicit
ownership source precedence/conflict/rescan-behavior rules; a separate,
not-yet-implemented ADR-0002 amendment proposal for the review-date scoring
input; confirmation of the `HealthIssue` → `GovernanceIssue` relationship;
reaffirmation of the 3-state resolution workflow with no `VERIFIED` state;
a simplified, purely role-based permission model with no document-level
exception; and the four-phase sequencing above). Phase 8A implementation
begins next.
