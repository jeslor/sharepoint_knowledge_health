# ADR-0020: Recursive Folder Traversal

Date: 2026-08-02
Status: Accepted

---

## Problem

`DocumentCollectorProcessor.collectSite()` (`apps/worker`) only enumerates a drive's root-level children (`listDocuments` → `GET /drives/{driveId}/root/children`). Folders *are* returned by that call — the code sees them and explicitly skips them (`if (!item.file) continue`) — but nothing ever expands into a subfolder. Any document not sitting directly at a drive's root is invisible to scanning, scoring, and governance. This has been a named, accepted limitation since Phase 5 ("no recursive folder traversal... `GraphDriveItem` doesn't yet expose enough to recurse correctly at scale") — this ADR closes it.

## Context

- ADR-0004: scan architecture — async, queue-based, incremental persistence, idempotent whole-job retry. This ADR extends collection depth, not the overall pipeline shape.
- ADR-0013: `packages/graph-client`'s architecture — async-generator pagination with real backpressure (§4), a strict DTO/domain separation (§6), and — the constraint this ADR is most directly bound by — a requirement that the package's public API stay completely product-agnostic (§9): "if a method name or parameter would be impossible to justify in a standalone, product-agnostic Graph SDK, it doesn't belong in this module."
- ADR-0014: the governing trust boundary — "the product never automatically scans a site... without an explicit, attributable admin action." Only `Approved` `SharePointSite` rows are ever scanned, at any depth.
- `Document`'s schema (`@@unique([siteId, graphItemId])`, a free-text `path` column) is already depth-agnostic — no migration is required by this decision.

## Decision

### 1. `packages/graph-client` gains one new, generic primitive: `listChildren`

```typescript
function listChildren(
  entraTenantId: string,
  driveId: string,
  itemId: string,
  options?: ListOptions,
): AsyncGenerator<GraphDriveItem>;
```

Built on the exact same `paginate()` + `mapGraphError()` pattern every other list function in this package already uses, calling Graph's real `GET /drives/{driveId}/items/{itemId}/children`. This passes ADR-0013 §9's test cleanly — it is a direct, generic Graph operation, arguably more complete than the existing root-only `listDocuments`, and requires no knowledge of scans, tenants, or business rules.

**`listDocuments` is left completely unchanged** — no signature or behavior change, so its existing callers and any future non-recursive use case are unaffected. `listChildren` is purely additive.

`GraphDriveItem` gains two new optional facet fields, matching Graph's own real response shape (ADR-0013 §6):

```typescript
interface GraphDriveItem {
  // ...existing fields...
  folder?: { childCount: number };
  // Present when this item is a shortcut/reference into a DIFFERENT
  // drive (e.g. "Add shortcut to OneDrive") — never inspected beyond
  // presence. Its existence alone is the signal to never recurse into
  // it; see §3 below.
  remoteItem?: unknown;
}
```

### 2. Traversal is iterative and owned entirely by `apps/worker`

`DocumentCollectorProcessor.collectSite()` replaces its flat loop with an **iterative** (explicit queue, not recursive function calls — keeps memory and call-stack bounded independent of tree depth) walk:

- Seed the queue with the drive's root, via the existing, unchanged `listDocuments`.
- Dequeue a folder; for each of its children, checked *before* branching on `.file`/`.folder` (§3): any item carrying a `remoteItem` facet is discarded outright — never persisted, never enqueued, regardless of which other facet it also carries. Otherwise:
  - `.file` items → the existing `upsertDocument` path, unchanged, processed and persisted immediately as they stream in (see §4 — never buffered).
  - `.folder` items, not already visited → enqueued for later expansion via `listChildren`.
- Repeat until the queue is empty.

Traversal recursion policy (what to expand, what to exclude, visited-set bookkeeping) lives entirely in `apps/worker`, per ADR-0013 §6 — `packages/graph-client` has no concept that traversal, depth, or exclusion exist.

### 3. `remoteItem` exclusion is a hard trust-boundary rule, not an optimization

Any item carrying a `remoteItem` facet is a shortcut/reference into a **different drive**, potentially a **different, non-`Approved` site** — Graph mirrors the remote target's own facet (`file` or `folder`) onto the shortcut item itself, so a `remoteItem` can appear on what otherwise looks like an ordinary file *or* an ordinary folder. Both shapes cross the same trust boundary: recursing into a remote **folder** shortcut would silently scan a site an Admin never approved, and persisting a remote **file** shortcut as a local `Document` would represent a document that doesn't actually belong to the approved site's own content — either way is a direct violation of ADR-0014's governing principle ("the product never automatically scans a site... without an explicit, attributable admin action").

**Clarification (2026-08-03, architecture review — closes an ambiguity found before Phase C.2 began):** the rule is not scoped to traversal alone. Stated explicitly and without qualification:

> **Any Graph `driveItem` containing a `remoteItem` facet MUST be excluded from both persistence and traversal, regardless of whether the item also contains a `file` or `folder` facet.**

Concretely: a `remoteItem`-faceted `.folder` item is never enqueued for expansion (unchanged from the original decision); a `remoteItem`-faceted `.file` item is never passed to `upsertDocument` either — it is not a document this organization owns, so it must never become a `Document` row, regardless of how convincingly Graph's inlined `file` facet makes it look like an ordinary local file. This also closes a related, pre-existing gap the same review surfaced: today, a file-shaped remote shortcut sitting at a drive's *root* already flows through the existing (non-recursive) `listDocuments` → `upsertDocument` path unfiltered, since nothing currently inspects `remoteItem` at all. Phase C.2's exclusion check must therefore apply uniformly to every item the traversal encounters — root-level and nested alike — not only to items reached through recursion.

### 4. No recursion depth cap — correctness over limiting depth

The traversal walks the **complete** folder tree with no maximum-depth cutoff. A depth cap was considered and rejected: SharePoint imposes no hard folder-depth limit, and a cap would mean some tenants' health scores silently and permanently exclude real content below the cutoff — the same kind of "quietly incomplete coverage" problem this ADR exists to fix in the first place. Safety instead comes from:

- **A visited-item-ID set**, defense-in-depth against a Graph API anomaly or future coding bug re-expanding the same folder. (A true cycle is not graph-theoretically possible within one SharePoint drive tree — folders form a tree, not a graph — but the guard is cheap and worth keeping regardless.)
- **The existing Graph SDK retry/throttling middleware** (ADR-0013 §3, unchanged) absorbing the higher call volume a full traversal produces (one call per folder instead of one per drive root) exactly as it already does for every other Graph call in this codebase.
- **The existing per-item and per-site failure isolation** (`document-collector.processor.ts`'s try/catch around each item persist and each site's enumeration) — a failure expanding one folder does not abort the rest of the traversal, matching the existing "one bad site/item doesn't abort the rest" guarantee.

### 5. Streaming is preserved — nothing is materialized in full

Consistent with ADR-0013 §4's "never buffer a full result set" guarantee: the traversal queue holds only **pending folder IDs to expand**, never file contents or full subtrees. Files are persisted (`upsertDocument`) the moment they're encountered while walking, exactly as today — not collected and written in a batch at the end. Memory usage is bounded by the queue's width (how many folders are currently pending expansion) plus one page of children at a time, not by total tree size.

### 6. No new concurrency

Traversal stays strictly sequential — one folder expanded at a time, per site, matching the existing sequential `for (const site of approvedSites)` structure. This avoids introducing a new throttling-risk surface in this change. Bounded parallel folder expansion is a reasonable future optimization once real scan-duration data justifies it, not a Phase C concern (avoid premature abstraction; optimize after measuring).

### 7. Persistence and reconciliation require no changes

`upsertDocument` (keyed on `(siteId, graphItemId)`) and `reconcileRemovedDocuments` (keyed on the same `graphItemId` set) are already indifferent to an item's depth or path. `Document.path` already stores `item.parentReference.path` as free text, so a nested item's full path is captured with zero schema or logic changes.

## Consequences

- **`packages/scoring`'s `Duplication` rule input pool grows** — its `siblingDocuments` set (built in `scoreTenantDocuments`, keyed by `name::sizeBytes`) will now include every file at every depth, tenant-wide, not just root-level files. No code changes in `packages/scoring` itself; named here explicitly so it isn't rediscovered as a surprise later. This is a correctness improvement (duplicates nested in different folders are now genuinely findable), not a regression.
- **Scan duration increases** for tenants with deep/wide structures — call volume rises from one-per-drive to one-per-folder. No new progress-reporting infrastructure is added for this (progress stays per-site, ADR-0015 §5, unchanged) — flagged under Future Considerations if it becomes a real operational problem.
- **Fully additive and backward-compatible**: a site with no subfolders traverses identically to today (the root-seed step is unchanged `listDocuments` output; a site with zero folder-faceted children never enqueues anything further).

## Acceptance Criteria

- `packages/graph-client`: `listChildren` unit-tested for pagination (`@odata.nextLink` following) and Graph error mapping, mirroring `sites.spec.ts`'s existing pattern. `listDocuments`'s existing behavior is unchanged (no test changes required there).
- `apps/worker`: a multi-level nested folder structure is fully traversed (proves real recursion, not one extra level); a `remoteItem`-faceted folder is never expanded, **and a `remoteItem`-faceted file is never persisted as a `Document`** — both at the root level and nested, per §3's clarification (the full trust-boundary proof); a folder returned twice (simulated anomaly) is expanded only once; existing reconciliation and per-item/per-site failure-isolation behavior is proven to still hold for nested items, not just root-level ones; a full existing-suite regression run stays green with no behavior changes to any currently-passing test.

## Future Considerations

- Bounded parallel folder expansion, if sequential traversal proves too slow in practice for very large/deep tenants — deferred until measured, not solved speculatively here.
- ADR-0004's already-deferred "v2: incremental/delta scans using the Graph delta query API" becomes more valuable as total scanned volume grows with full-tree traversal — this ADR doesn't change that decision, just makes it more relevant sooner.
- If a future feature needs visibility into *why* a site's scan is taking unusually long (e.g., a very deep or wide tree), finer-grained progress reporting could be added then — not needed for this ADR's scope.
