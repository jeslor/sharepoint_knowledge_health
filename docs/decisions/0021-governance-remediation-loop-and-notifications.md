# ADR-0021: Governance Remediation-Loop Closure and Notifications

Date: 2026-08-04
Status: Accepted (2026-08-04) — both open decisions (§3.3, §3.6) resolved on review; see each section for the approved wording

---

## 1. Problem Statement

ADR-0016 built a genuinely complete governance *tracking* layer — `GovernanceIssue`, assignment, a 3-state resolution workflow, a full append-only `GovernanceActivity` audit trail, and analytics on top of it. What it explicitly did not build, and named as a deferred decision rather than an oversight, is anything that closes the loop once a human acts: **ADR-0016 §10 states notifications "would need its own separate ADR and its own explicit justification."** This ADR is that justification.

A product/architecture review of the current implementation (this session) traced the actual, current, code-verified lifecycle of a detected issue: a scan produces a score and issues → a human must remember to open the document and manually track each issue one at a time → a human must separately remember to assign it → **the assignee is never told, by anything** → work happens entirely outside the system → someone must remember to check back, notice a passive `stillDetected` flag, and manually close it. Every step after the initial scan depends on a human remembering to act, with zero system-initiated prompts. The product measures knowledge health completely; it does not yet drive remediation of it.

## 2. Current Limitation

Verified directly against the running implementation, not assumed:

1. **No notification mechanism exists anywhere in the codebase** — confirmed by ADR-0016 §10's explicit scope exclusion and by a full search of the current source; nothing sends, queues, or renders a notification of any kind today.
2. **`stillDetected` (ADR-0016 §4.1) is real, correctly computed data, but purely passive** — it only appears if a human happens to revisit that specific issue's detail page. Nothing surfaces a resolved-but-unconfirmed, or confirmed-but-still-detected, issue proactively.
3. **Issue tracking is one-at-a-time, not bulk** — `TrackInGovernanceButton` renders per issue on the document detail page; a document with four low criteria requires four separate round trips, and clicking it a second time for an already-tracked issue surfaces a raw `409` error message ("...use PATCH to update it") that isn't meaningful to a non-technical user.
4. **A `Member`-role assignee has no self-service path.** `PATCH /organizations/:id/governance/issues/:issueId` is gated `@Roles('Admin', 'GovernanceManager')` for its entire body — a `Member` who is `assignedUserId` on an issue cannot update its status or resolution notes themselves, even for an issue assigned specifically to them (`governance-issues.controller.ts:97-99`). This is a direct, load-bearing consequence of ADR-0016 §4.6's deliberate v1 decision to reject any resource-scoped ("the assignee can act on their own issue") authorization exception. That decision is not wrong on its own terms — it was made because nothing at the time needed it. This ADR is the first concrete requirement that does — resolved in §3.6 below with a narrow, resource-scoped exception, not a silent override.

## 3. Decision

### 3.1 Notification delivery: in-app only for V1

**No email, no Teams/Slack integration in V1.** Reasoning: email requires a genuinely new external dependency (a transport provider, deliverability/bounce handling, unsubscribe/compliance obligations) that this ADR should not decide casually, consistent with how ADR-0003 treated the Graph write-scope decision ("request the additional write scope as a separate, explicitly-justified consent step at that time") and how this project's engineering principles treat "avoid unnecessary dependencies." An in-app `Notification` model is additive and forward-compatible with email later — the same row shape could gain a `deliveredViaEmail: boolean` or a separate delivery-log table without redesign, matching the upgrade-path precedent ADR-0002 already established for the scoring config and ADR-0007 established for `DocumentOwner.source`.

### 3.2 What triggers a notification, and how — two genuinely different mechanisms

**Synchronous, action-triggered notifications** (assignment-shaped events) — created inline, inside `apps/api`, at the exact moment `GovernanceActivityService.record()` already writes the corresponding activity row. No new write path; this hooks the *one already-centralized* place ADR-0016 §14 established for exactly this kind of "something happened, act on it" logic.

| Trigger (existing `GovernanceActivityType`) | Recipient | Included in V1? |
|---|---|---|
| `IssueAssigned` / `AssigneeChanged` | the new assignee | Yes |
| `OwnerAssigned` | the new document owner | Yes |
| `IssueReopened` | the current assignee, if any | Yes |
| `IssueCreated` | — | No (the actor already knows; they just did it) |
| `StatusChanged` (Open→InProgress) | — | No — low value, usually self-initiated by the same person |
| `ResolutionNoteUpdated` | — | No — would fire on every edit, pure noise |
| `OwnerRemoved` | — | No — low value for V1 |

**Asynchronous, derived-state notifications** (the "resolution verification" case) — this is a fundamentally different problem. Nothing *happens* at the instant `stillDetected` flips from true to false; it's a comparison that only becomes true the next time someone computes it. There is no event to hook. This requires a periodic reconciliation check, not an inline hook — see §3.3 for where it lives and the one real boundary question it raises.

V1 scope: only the primary direction — an `Open`/`InProgress` issue whose `stillDetected` flips to `false` generates a `ResolutionSuggested` notification to its assignee (if any; unassigned issues generate none — there's no well-defined single recipient, and guessing at Admin/GovernanceManager-wide broadcast risks noise for larger orgs, so V1 deliberately doesn't). The symmetric case (a `Resolved` issue whose `stillDetected` flips back to `true` — a regression) uses the identical mechanism and is trivial to add once the reconciliation job exists, but is deferred to keep V1's decision surface minimal, per §4.

### 3.3 Where the reconciliation check lives — a narrow, explicit amendment to ADR-0016

**Approved: a new, separate periodic job in `apps/worker`, reusing the proven `SchedulerBootstrapService`/BullMQ-repeatable-job pattern** (ADR-0015) rather than inventing a new mechanism. Not folded into `DocumentCollectorProcessor` — that processor was just extended for recursive traversal (ADR-0020) and should not absorb an unrelated concern; "one execution path per concern" is a discipline this codebase has held consistently (worker computes scores, api serves governance, and now: a third, cleanly separate concern — notification reconciliation). Not a new queue — reusing the existing scheduler's registration mechanism (a second repeatable job, its own `@Processor`) avoids new Redis retention/queue-config decisions for what is fundamentally one more lightweight periodic check. It recomputes from current truth on every tick (no "since last check" bookkeeping) — the same stateless-recompute pattern `findDueScanSchedules` already uses — and skips creating a duplicate `ResolutionSuggested` notification if one already exists for that `(governanceIssueId)` (an application-level check, matching how `GovernanceIssue`'s own lazy-creation duplicate check already works — no new DB constraint pattern introduced).

**This requires reading `GovernanceIssue` from `apps/worker`, which ADR-0016 §5 states plainly does not happen today**: *"`apps/worker` is entirely unmodified in its scoring/issue-generation responsibilities... the worker never touches `GovernanceIssue`, in either direction."*

**Approved (2026-08-04).** The **write**-side prohibition remains absolute and unchanged — `apps/worker` still never creates, updates, or resolves a `GovernanceIssue`, under any circumstance; that boundary is what makes `GovernanceIssue` trustworthy as a 100%-human-driven record (ADR-0016 §4.5), and this ADR does not touch it. What's approved is a new, narrowly-scoped **read**-only capability, used for exactly one purpose (deciding whether to write a `Notification` — a new entity with no bearing on `GovernanceIssue`'s own state).

**The rule, stated precisely for implementation**:
- A worker process **may read** `GovernanceIssue` state for the sole purpose of computing derived notifications.
- A worker process **must never mutate** `GovernanceIssue` lifecycle state (`status`, `assignedUserId`, `resolutionNotes`, `resolvedAt`) — that remains exclusively `apps/api`'s write path, with no exception.
- `DocumentCollectorProcessor` is **not** the place this happens and remains entirely unchanged by this ADR — no scan-time code reads or reacts to `GovernanceIssue`.
- Notification reconciliation is implemented as its **own separate processor/job**, decoupled from scanning, so the scan pipeline's existing behavior, tests, and review history (ADR-0004/0020) stay undisturbed.

ADR-0016 §5's wording is updated to reflect this distinction precisely — see the amendment recorded directly in that ADR (§16).

### 3.4 Read/unread state and retention

`Notification.read: boolean`, defaulted `false`; a `PATCH` to mark one read, and a bulk `mark-all-read` convenience endpoint (mirrors the "single action, common case" shape `ScanSchedule`'s enable/disable already uses). No timestamp-based "seen" tracking beyond that — matches this codebase's preference for the simplest state that satisfies the actual requirement.

**Retention: no automatic pruning in V1**, growing unboundedly — the identical, already-accepted posture this project takes for `AuditLog` (ADR-0019: "No automatic retention/pruning policy is defined here... grows unboundedly, same accepted-for-now posture") and `ScanJob`/`HealthScore` before it (ADR-0015 §2). Introducing a bespoke retention policy for just this one table, where none exists anywhere else in this schema, would be a new, unjustified pattern.

### 3.5 The complete lifecycle, as implemented by this ADR

```
HealthIssue detected (scan, unchanged — ADR-0002/0004)
  → GovernanceIssue created (human action, unchanged — ADR-0016 §4.1, now with a bulk option — §4)
  → Owner assigned (human action, unchanged — ADR-0016 §4.2)
  → Owner notified (NEW — synchronous, via GovernanceActivityService's existing write path)
  → Remediation happens (outside the system, in SharePoint — unchanged)
  → Owner marks in-progress / adds notes / marks resolved (self-service — NEW, §3.6)
  → Next scan runs (unchanged — manual or scheduled, ADR-0004/0015)
  → stillDetected recomputes to false (unchanged, derived, read-time — ADR-0016 §4.1)
  → Verification prompt notification (NEW — periodic reconciliation, §3.3)
  → Assignee (self-service, §3.6) or Admin/GovernanceManager confirms → status: Resolved
  → GovernanceActivity records the transition (unchanged — ADR-0016 §4.5/§14)
  → Governance analytics reflect it (unchanged — ADR-0016 §15/Phase 8D)
```

### 3.6 Assignee self-service rights — Approved: option B, narrow resource-scoped exception

**Approved (2026-08-04).** A `GovernanceIssue`'s current `assignedUserId` gains exactly three self-service rights, on **that issue only**:

- Move it forward one step: `Open → InProgress`, `InProgress → Resolved`.
- Update its `resolutionNotes`.

Explicitly **not** granted to the assignee, under any circumstance:

- Reopening (`Resolved → Open`) — stays `Admin`/`GovernanceManager`-only. Reopening is the more consequential, audit-sensitive edge (it reverses a prior resolution decision) and is deliberately excluded from the self-service carve-out.
- Reassigning the issue to someone else.
- Modifying any issue not currently assigned to them — this is a strictly resource-scoped exception (their own assigned issue, nothing else), not a role change. It does not grant `Member` any new organization-wide capability.

`Admin`/`GovernanceManager` retain every existing capability from ADR-0016 §4.6's table unchanged — this is additive for the assignee, not a narrowing of what Admin/GovernanceManager can already do.

This is this ADR's one approved amendment to ADR-0016 §4.6's permission table — recorded there directly (§16) rather than left implicit. Without it, notifying a `Member` assignee would have produced a dead end (told about work they cannot record having done); this closes that gap while keeping the exception as narrow as the actual requirement.

## 4. What can be reused (no changes required)

| Existing piece | How it's reused |
|---|---|
| `GovernanceIssue` | Read-only for notification triggers and the reconciliation check; no schema change |
| `GovernanceActivity` + `GovernanceActivityService.record()` | The exact hook point for every synchronous notification (§3.2) — extended, not replaced |
| `DocumentOwner` | Read-only trigger source for `OwnerAssigned` |
| `HealthIssue` | Read-only, same `(healthScoreId, criterion)` matching `governance-issues.service.ts`'s `enrichIssues` already does — the reconciliation check reuses this exact logic, not a new derivation |
| `HealthSnapshot` | Not needed for V1 notifications; a plausible input for a future "score improved" framing, not built now |
| `ScanJob` / scan history | Not read directly — the reconciliation check recomputes `stillDetected` from current `HealthIssue` state each tick, stateless, matching `findDueScanSchedules`'s own pattern; it doesn't need to know *which* scan caused a change |
| `AuditLog` | Untouched, distinct concern (administrative actions, not per-user notifications) — no overlap |

**Nothing above requires a schema or behavior change.** The only new write surface is the `Notification` table itself.

## 5. Minimum viable implementation

**V1 (must-have):**
- `Notification` model, read/unread state, in-app only
- Synchronous notifications: `IssueAssigned`/`AssigneeChanged`, `OwnerAssigned`, `IssueReopened`
- Asynchronous `ResolutionSuggested` notification via the new periodic reconciliation job (§3.3)
- "Assigned to me" surfaced on dashboard load; a notification indicator with unread count
- Bulk "track all issues on this document" action (closes gap §2.3) — **scope guardrail, approved 2026-08-04**: this is a thin loop over `GovernanceIssuesService`'s existing single-issue `createIssue` logic (skip any `(documentId, issueType)` pair that already has one, matching the existing duplicate check), exposed as one new controller method. It is explicitly **not** a new module, queue, or batch-processing subsystem — if a document's currently-detected issue count is ever large enough that this needs to be async/batched, that's a future decision to make once real usage shows it's needed, not now.
- Assignee self-service permissions (§3.6, approved)

**Later (explicitly deferred, not designed further here):**
- Email notifications (§3.1)
- Teams/Slack integration
- The symmetric `ResolutionRegressed` notification (trivial once the reconciliation job exists, but not core to closing the loop)
- SLA deadlines / due dates on `GovernanceIssue`
- Escalation (auto-reassignment, manager alerts after N days)
- External ticket integration (Jira/ServiceNow)
- Evidence/comment threads (replacing the single overwritable `resolutionNotes` field)
- Notification retention/pruning policy (deferred exactly like `AuditLog`, revisit only if volume ever becomes a real problem)

## 6. Data Model Proposal

Fully additive — no existing table altered, matching every migration in this project to date.

```prisma
enum NotificationType {
  IssueAssigned
  OwnerAssigned
  IssueReopened
  ResolutionSuggested   // "this may now be resolved — confirm?"
}

model Notification {
  id                String            @id @default(cuid())
  organizationId    String
  userId            String            // recipient — NOT an audit "who did this" field
  type              NotificationType
  message           String            // pre-resolved, human-readable at write time — matches
                                       // GovernanceActivity's "resolve once, read cheaply" precedent
  governanceIssueId String?
  documentId        String?
  read              Boolean           @default(false)
  createdAt         DateTime          @default(now())

  organization    Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user            User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  governanceIssue GovernanceIssue? @relation(fields: [governanceIssueId], references: [id], onDelete: SetNull)
  document        Document?        @relation(fields: [documentId], references: [id], onDelete: SetNull)

  @@index([organizationId, userId, read])
  @@index([organizationId, userId, createdAt])
}
```

Notes:
- `userId`'s `onDelete: Cascade` is a deliberate deviation from this schema's usual `SetNull`-for-audit-fields pattern — every other `<action>ByUserId` field exists to preserve *who did something* even after that user is gone; `Notification.userId` exists only so its recipient can read it, and has no meaning once they can't.
- No `@@unique` constraint for de-duplicating reconciliation notifications — matches `GovernanceIssue`'s own precedent of an application-level existence check rather than a DB constraint for its lazy-creation duplicate guard.
- `Notification` is a **personal inbox** (filtered to `userId = current user`), not a duplicate of `GovernanceActivity` (a **shared, organization-wide** audit feed). They answer different questions, the same way `HealthIssue` and `GovernanceIssue` deliberately stay two different entities answering two different questions (ADR-0016 §4.1).

### API surface (proposed shape, not finalized — matching ADR-0016 §7's own framing)

```
GET   /organizations/:id/notifications                 paginated, filterable by read/unread, current user only
PATCH /organizations/:id/notifications/:notificationId  { read: true }
POST  /organizations/:id/notifications/mark-all-read
GET   /organizations/:id/notifications/unread-count     lightweight, for a nav badge
POST  /organizations/:id/documents/:documentId/issues/track-all   bulk-create GovernanceIssues for every currently-detected HealthIssue on a document
```

Per §3.6 (approved): `PATCH .../issues/:issueId` gains a resource-scoped authorization path — the existing `@Roles('Admin', 'GovernanceManager')` check is extended (not replaced) with "...or the current `assignedUserId`, restricted to `resolutionNotes` and one forward status step (never reopen, never reassignment)."

## 7. UX Proposal

**Admin assigning issues**: unchanged from today (`GovernanceIssueControls` on the issue detail page) — the only change is what happens next: the assignee now receives a notification instead of silence.

**Document owner receiving work**: signs in, sees an unread-count badge in the nav (new), opens it to a filtered "assigned to me" view, clicks through to the issue — no change to the issue detail page itself beyond arriving there via a notification instead of by remembering to check.

**Owner fixing issues**: unchanged — happens in SharePoint, outside the system, exactly as today. Per §3.6, the owner can now also update `resolutionNotes` or move the issue to `InProgress` themselves, without needing an Admin to do it on their behalf.

**Owner confirming completion**: per §3.6, the assignee can mark their own assigned issue `Resolved` directly — a real change from today, where only Admin/GovernanceManager could.

**Admin verifying resolution**: the new step. After the next scan, if `stillDetected` flips false on an issue still `Open`/`InProgress`, its assignee gets a `ResolutionSuggested` notification and can confirm it themselves (per §3.6) — the first point in the entire lifecycle where the system proactively tells anyone something changed, rather than requiring someone to go looking. An Admin/GovernanceManager retains the ability to do the same for any issue, self-service or not — this doesn't remove their existing oversight, it adds a path that doesn't require them to be the bottleneck for every single confirmation.

## 8. Roadmap Placement

`docs/product/roadmap.md`'s current V2 list (Duplicate Detection, Knowledge Freshness, AI Readiness, Broken Links, Taxonomy Quality, Knowledge Owners, Review Automation, Search Quality, Analytics) has no stated ordering. Per the review preceding this ADR: this phase is recommended **ahead of all of them** —

- **Knowledge Freshness**: the `Freshness` criterion (30% weight) already ships; without more specificity on what this V2 item adds beyond existing scoring, it's unclear it's net-new value at all.
- **Duplicate Detection (fuzzy/content)**: would require downloading file content, directly conflicting with the collector's explicit, stated "metadata only, no content ever downloaded" design principle — a bigger, riskier lift than it first appears, needing its own ADR just to justify the scope change.
- **Knowledge Owners**: real but incremental — ownership *assignment* already fully works (Phase 8A/8B); this would mostly be coverage/reporting views on data that already exists. Reasonable as a **follow-on** to this ADR (same subsystem, low marginal cost), not ahead of it.
- **AI Readiness**: closer to a reframing of existing signals than new capability (ADR-0016 §9 says as much itself) and carries product-positioning risk this project's own stated philosophy ("not a chatbot... do not add AI features unless they provide measurable business value") means shouldn't be decided as an engineering side-effect of this review.

Recommended roadmap update: insert "Governance Remediation Loop (notifications, verification)" at the top of the V2 list, ahead of the existing nine items, with "Knowledge Owners" annotated as a natural, low-cost follow-on once this ships.

## 9. Risks

1. **The §3.6 resource-scoped exception is a real, if narrow, precedent** — this codebase's first non-role authorization check. Implementation must keep it exactly as scoped (own-issue-only, no reopen, no reassignment) and test that boundary explicitly, not just the happy path.
2. **The ADR-0016 worker read-boundary amendment (§3.3)** is a real, if narrow, change to a previously-stated absolute rule. Implementation must keep the reconciliation job structurally incapable of writing `GovernanceIssue` (e.g., don't hand it a full read-write repository if a narrower read-only accessor is feasible) — enforced by code shape, matching how this project has enforced every other boundary (`packages/graph-client`'s read-only surface, `AuditLogRepository`'s missing `updateById`).
3. **Notification volume/noise** — deliberately minimized in V1 (no `StatusChanged`/`ResolutionNoteUpdated` triggers, no unassigned-issue broadcast), but real usage should be watched before adding more trigger types.
4. **No retention policy** means this table grows unboundedly, same accepted risk profile as `AuditLog` — worth the same future look if either ever becomes large enough to matter.

## 10. ADRs Requiring Amendment

- **ADR-0016 §5**: "the worker never touches `GovernanceIssue`, in either direction" — narrowed to "never *writes*," per §3.3. Recorded as a dated amendment directly in ADR-0016 (§16).
- **ADR-0016 §4.6**: gains the narrow resource-scoped authorization exception from §3.6. Recorded as a dated amendment directly in ADR-0016 (§16).
- **No other ADR requires a change.** `GovernanceIssue`, `GovernanceActivity`, `HealthIssue`, `HealthSnapshot`, `DocumentOwner`, and the scan pipeline are all consumed exactly as already decided.

Status: **Accepted (2026-08-04)**. Both open decisions resolved on review (§3.3, §3.6). Implementation planning follows; no code until this ADR and its ADR-0016 amendment are committed.

## 11. Amendment (2026-08-04 — Hybrid Multi-Channel Architecture)

A product/architecture review, after Phase D.1 shipped but before D.2 began, evaluated whether notifications should support multiple delivery channels (In-App, Email, Microsoft Teams, and later external integrations), each independently configurable per organization. This amendment supersedes §6's single-table schema and the "in-app only, no design for later" framing of §3.1/§5 — every other decision in this ADR (§3.1's in-app-first sequencing, §3.2's trigger set, §3.3's worker read-boundary, §3.5's lifecycle, §3.6's assignee self-service) stands unchanged.

### 11.1 Decision: a right-sized two-table split, not a generic event bus, not a bare channel field

Evaluated three options:

- **Bare `channel` field on the existing `Notification` table** — rejected. The moment one trigger is configured to deliver over more than one channel, independent per-channel failure/retry state is unavoidable, and a single row can't represent two different channels' outcomes cleanly. This would only defer the real design problem to whoever builds the second channel.
- **A generic `NotificationEvent` + `NotificationDelivery` pub/sub abstraction** (multiple recipients per event, arbitrary subscriptions) — rejected as more than this product needs. Every currently-defined `NotificationType` (`IssueAssigned`, `OwnerAssigned`, `IssueReopened`, `ResolutionSuggested`) has exactly one recipient. There is no multi-recipient fan-out requirement to design for. Building one speculatively would be over-engineering for "an early enterprise SaaS product."
- **Approved: `Notification` (one row per recipient per trigger, channel-agnostic) + `NotificationDelivery` (one row per channel actually sent)**. The fan-out that's real is *channels per recipient* (1→N), not *recipients per event* — the schema is scoped to solve exactly that, no more. `GovernanceActivity` remains the sole event source for every synchronous trigger type (§3.2, unchanged) — `NotificationDelivery` fans out an existing `Notification`, it does not duplicate `GovernanceActivity`.

### 11.2 Revised data model (supersedes §6's schema)

```prisma
enum NotificationChannel {
  InApp
  // Email, Teams added additively once their own ADRs are accepted —
  // deliberately not pre-declared (Phase 5's migration notes: Postgres
  // enum values can't be removed later without a full type rebuild;
  // committing to channel names before they're scoped risks being stuck
  // with a wrong one).
}

enum NotificationDeliveryStatus {
  Pending
  Sent
  Failed
}

model Notification {
  id                String            @id @default(cuid())
  organizationId    String
  userId            String            // the one recipient — every current trigger type is 1:1
  type              NotificationType
  message           String            // channel-agnostic base text
  governanceIssueId String?
  documentId        String?
  sourceActivityId  String?           // FK -> GovernanceActivity; null only for ResolutionSuggested,
                                       // which has no human/API-triggering activity — it's a system
                                       // observation (the reconciliation job, ADR-0021 §3.3), not an event
  read              Boolean           @default(false)  // in-app acknowledgment ONLY — see 11.4
  createdAt         DateTime          @default(now())

  deliveries NotificationDelivery[]
  // organization/user/governanceIssue/document relations unchanged in shape from the original §6 design
}

model NotificationDelivery {
  id             String                     @id @default(cuid())
  organizationId String
  notificationId String
  channel        NotificationChannel
  status         NotificationDeliveryStatus @default(Pending)
  attemptCount   Int                        @default(0)
  lastError      String?
  sentAt         DateTime?
  createdAt      DateTime                   @default(now())

  notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)

  @@unique([notificationId, channel])
}

// Shape declared now; table and admin settings UI deliberately deferred to
// the Email phase (D.3) — In-App is the only channel through D.2 and is
// non-configurable, so there is nothing to configure yet. Building this
// before a second channel exists would be speculative.
model NotificationSetting {
  id             String              @id @default(cuid())
  organizationId String
  type           NotificationType
  channel        NotificationChannel
  enabled        Boolean             @default(false)  // fail-closed: no row, or disabled, means not sent
  @@unique([organizationId, type, channel])
}
```

`markRead`/`markAllReadForUser` (§Phase D.1 repository) operate on `Notification`, unchanged — they were never channel-specific to begin with, since `read` always meant in-app acknowledgment.

### 11.3 Delivery flow and retry

Dispatch (wherever `GovernanceActivityService.record()` fires, or the reconciliation job for `ResolutionSuggested`) reads `NotificationSetting` for `(organizationId, type)`, creates one `Notification`, and one `NotificationDelivery` per **enabled** channel — In-App is always included unconditionally (not configurable, per product decision) regardless of `NotificationSetting`'s contents.

For Email/Teams (not built yet, D.3/D.4): dispatch is a **queued `apps/worker` job, reusing the exact retry/backoff shape already proven for `SCAN_QUEUE`/`DISCOVERY_QUEUE`** (`attempts: 3`, exponential backoff — ADR-0004's amendment), not a synchronous call inside whatever API request triggered it. This is a new `apps/worker` processor at that time, consistent with ADR-0009's "worker is the only queue consumer" pattern — named here so D.3 doesn't have to rediscover it. In-App delivery is always immediately `Sent` (a database write either succeeds or the triggering request already failed) — it does not need queuing.

### 11.4 Ownership, restated precisely for a multi-channel world

`userId` is the recipient — the one authoritative answer to "whose notification is this," unchanged from §6. `read` means **in-app acknowledgment only** and must never be redefined to mean "acknowledged via any channel" — Teams/email read-receipts are unreliable and not something this system reliably observes. If a future channel's read-state is ever surfaced, it belongs on that channel's own `NotificationDelivery` row, never conflated into `Notification.read`.

### 11.5 Source-of-truth — restated as a structural requirement, not just a policy

§3.3's write-boundary (a worker process must never mutate `GovernanceIssue` lifecycle state) already established that no automated process may resolve a `GovernanceIssue`. This amendment extends the same principle explicitly to every future notification channel: **a Teams message, an email action, or any external system's "completed" signal must never automatically resolve a `GovernanceIssue`, update its status, or write to `GovernanceActivity`.** The only trusted verification path remains: SharePoint scan → scoring engine → `stillDetected` → human confirmation (§3.5/§3.6).

This must be enforced structurally, not only by this ADR's text. **Binding requirement for the future Teams ADR**: Teams integration must use its own, separate Azure AD app registration / Bot resource, with credentials that have no path to the authenticated-user guard chain (`EntraJwtGuard`/`TenantContextGuard`/`OrganizationAccessGuard`/`RolesGuard`) that `PATCH .../issues/:issueId` requires. This is what actually prevents a future "Mark Resolved" Teams button from being wired directly to that endpoint under time pressure — not code review discipline alone.

### 11.6 Email and Teams remain their own, separately-justified future ADRs

Restated and sharpened from §10:

- **Email (D.3)**: recommend Microsoft Graph `Mail.Send` over an external provider (SendGrid, etc.) — consistent with this product's M365-native positioning, avoids a new vendor dependency, and mail sent through the customer's own tenant is more trusted/deliverable than third-party-domain mail. **Binding requirement for that ADR**: `Mail.Send` as an application permission can send as any user in the tenant unless restricted — the future ADR must require a dedicated service mailbox plus an Exchange Application Access Policy scoping the grant to that mailbox only. Sequenced before Teams: cheaper, more universal, no bot-approval friction, still real value.
- **Teams (D.4)**: realistically requires a registered Teams bot (Azure Bot Service + a Teams app manifest for the customer's Teams admin to approve), not merely an additional Graph scope on the existing app registration — proactive 1:1 notification messaging is not straightforward via plain application-permission Graph calls. Must use a separate Azure AD app registration from the SharePoint-reading one (§11.5). Enterprise Teams-app approval processes can take weeks — this is a go-to-market/sales-cycle consideration for whoever scopes that ADR, not only an engineering cost.
- **External integrations (Jira/ServiceNow/Planner, D.5)**: named as a future direction, not scoped. Framed as hand-off integrations (export/sync a `GovernanceIssue` into an existing system of record), not as notification channels in the same sense as Email/Teams — validate real customer demand before writing that ADR.
- **User-level notification preferences**: deliberately not designed. If ever built, must be constrained to *narrow* what an organization's `NotificationSetting` allows, never expand it — otherwise a user could silently re-enable a channel an Admin deliberately disabled (e.g., for a compliance reason on "critical issues"). Named now so it isn't overlooked whenever that feature is actually considered.

### 11.7 Updated V1→V2 phase sequencing

- **D.1** *(built)*: `Notification` foundation — schema now superseded by §11.2; needs a corrective migration before D.2 begins.
- **D.2**: in-app loop closure on the revised two-table schema. No new ADR — this amendment covers it.
- **D.3**: Email (`Mail.Send`, dedicated mailbox + Application Access Policy, `NotificationSetting` table and admin settings UI built here). Own ADR.
- **D.4**: Microsoft Teams (separate Azure Bot registration). Own ADR, resolving the bot-vs-Graph question explicitly before code.
- **D.5**: External integrations — named, not scoped.

## 12. Correction (2026-08-05) — §11's schema split was premature; reverted

A further, more adversarial architecture review of §11 concluded that the `NotificationDelivery`/`NotificationSetting`/`channel` design was over-engineering, and reverses it. This section supersedes §11's data model and phase sequencing (§11.2, §11.3, §11.7); §11.1's reasoning about *why* a bare `channel` field alone is insufficient still stands and is worth keeping for when the split is actually built — only the *timing* was wrong. Everything else in this ADR (§1–§10, and §11.4–§11.6's ownership/source-of-truth/channel-sequencing reasoning) is unaffected and still holds.

### 12.1 Why the reversal

`NotificationDelivery` exists to track one thing: a channel-specific delivery attempt with its own independent status and retry state. Today there is exactly one channel (In-App), and it has none of the properties that table exists for — a database write cannot meaningfully fail, needs no retry, and has no status distinct from the `Notification` row's own existence. Building it now optimizes for a fan-out scenario (a second channel) that has zero current instances.

The specific argument for building it early — "retrofitting after D.2 ships an API contract is more expensive than doing it now" — does not hold up: **this product is pre-launch, with no production data**, and every migration in this project (ADR-0004, ADR-0007, ADR-0016's own Migration Strategy sections) is additive and low-risk precisely because of that. The cost of introducing `NotificationDelivery` later, when a second channel actually exists, is not meaningfully higher than introducing it now. Treating this as if API consumers already depended on today's shape was the actual error.

A bare `channel` field alone (without the full delivery split) was considered as a middle ground and also rejected — with only one channel, the field is inert (always one value), provides no query or business value today, and doesn't meaningfully reduce the cost of the eventual real split when it's needed. It would just leave the wrong-shaped intermediate structure live for no benefit.

### 12.2 What actually happens now

**No schema or code change at all.** Phase D.1's original schema — `Notification` (`id`, `organizationId`, `userId`, `type`, `message`, `governanceIssueId?`, `documentId?`, `read`, `createdAt`), already migrated — is correct as originally built and needs no revision. The corrective migration proposed in §11 is abandoned, not applied. Phase D.2 proceeds directly on the existing schema.

### 12.3 Revised phase sequencing (supersedes §11.7)

- **D.1** *(built, unchanged, no correction needed)*: `Notification` foundation.
- **D.2**: in-app loop closure on the existing D.1 schema — synchronous triggers added directly at `GovernanceActivityService.record()`'s existing call sites (no new dispatch/decision layer, since there is exactly one channel and nothing to decide), the reconciliation job (§3.3, unchanged), the existing API/frontend shape (§6/§7). No new ADR.
- **D.3**: Email (`Mail.Send`, dedicated mailbox + Exchange Application Access Policy, own Azure app registration, own ADR). **This is the correct point to introduce per-channel delivery tracking and org-level settings** — the first moment a channel with real failure/retry semantics exists. Include a scheduled digest capability (daily/weekly rollup email, reusing the existing `ScanSchedule`/BullMQ pattern, ADR-0015) as part of or immediately following this phase — cheap once `Mail.Send` exists, and serves a distinct, high-value persona (compliance/CIO) that real-time channels don't.
- **D.4**: Microsoft Teams (separate Azure Bot registration, own ADR, own consent flow) — sequenced after Email specifically because Email is cheaper, universal, and lower-approval-friction, and proves the multi-channel mechanism before taking on Teams' materially higher cost.
- **D.5+**: severity-based policy routing (§6 of the 2026-08-05 review — only after real D.3/D.4 usage data justifies it), external ticketing/Planner (named, not scoped, validate demand first), user-level preference overrides (named, not scoped; if ever built, constrained to only narrow what an organization's settings allow, never expand it).
