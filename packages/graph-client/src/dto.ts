// Graph-shaped DTOs only — field names and shapes stay close to Graph's own
// API responses, deliberately not renamed to match any product's schema
// (ADR-0013 §6). Mapping into a domain model happens entirely outside this
// package.

export interface GraphSite {
  id: string;
  webUrl: string;
  displayName: string;
  // Authoritative Graph field distinguishing a user's personal OneDrive site
  // from an organizational SharePoint site — not a heuristic. Optional
  // because getSite() (GET /sites/{id}) does not return it; only listSites()
  // (GET /sites/getAllSites) does.
  isPersonalSite?: boolean;
}

export interface GraphDrive {
  id: string;
  name: string;
  webUrl: string;
  driveType: string;
  // Populated via $expand=list($select=id) on the same listDrives request
  // (no extra Graph call) — the underlying SharePoint list backing this
  // document library. Absent/undefined for drive types with no associated
  // list (e.g. some non-SharePoint drive kinds); Graph documents this
  // relationship as nullable.
  list?: { id: string };
}

// Graph-shaped column metadata (site column or list column). Deliberately
// generic/product-agnostic (ADR-0013 §6) — this package has no notion of
// "review date," only of columnDefinition's own documented shape. The
// `dateTime` facet's presence (vs. text/choice/number/etc., which are
// mutually exclusive per Graph's own schema) is the one structurally
// guaranteed type signal; its value is intentionally untyped here since
// callers only ever check for the key's presence, never its contents.
export interface GraphColumnDefinition {
  id: string;
  name: string;
  displayName: string;
  hidden?: boolean;
  dateTime?: Record<string, unknown>;
  // Whether a customer can delete this column via SharePoint's own UI —
  // false for platform-managed system columns (e.g. Created/Modified),
  // true (or absent, on some response shapes) for anything the customer
  // authored themselves. A structural signal, not a name guess.
  isDeletable?: boolean;
}

export interface GraphContentType {
  id: string;
  name: string;
  columns?: GraphColumnDefinition[];
}

// One row from GET /sites/{id}/lists/{id}/items?$expand=fields(...) — a
// single-relationship expand, matching Microsoft's own documented example
// on the fieldValueSet resource page exactly
// ("?expand=fields(select=Author,BookTitle,PageCount)"). fields is
// narrowed by the caller's own $select to the one column it asked for, so
// its shape is intentionally a loose record.
export interface GraphListItemWithFields {
  id: string;
  fields: Record<string, unknown>;
}

// One row from GET /sites/{id}/lists/{id}/items?$expand=driveItem(...) —
// also a single-relationship expand (driveItem alone, not combined with
// fields). driveItem is the documented reciprocal of driveItem.listItem
// (listItem resource type: "For document libraries, the driveItem
// relationship exposes the listItem as a driveItem") — present for
// document-library items, which is the only list type this package's
// callers ever query. Deliberately a separate call/DTO from
// GraphListItemWithFields rather than a combined $expand=fields,driveItem
// — Graph's own query-parameter documentation cautions "for some APIs,
// only one relationship can be expanded in a single request," and no
// authoritative example combining two different relationship expansions
// on listItem was found. Two individually-documented single-relationship
// requests, joined by the shared listItem id, avoids relying on that
// unconfirmed compound shape.
export interface GraphListItemDriveItemRef {
  id: string;
  driveItem?: { id: string };
}

export interface GraphDriveItemIdentity {
  displayName?: string;
  email?: string;
}

export interface GraphDriveItem {
  id: string;
  name: string;
  webUrl: string;
  size: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  file?: { mimeType: string };
  // ADR-0020: present when this item is a folder — used by apps/worker's
  // recursive traversal to decide what to expand. A driveItem carries
  // exactly one of `file`/`folder`, never both.
  folder?: { childCount: number };
  // ADR-0020 §3: present when this item is a shortcut/reference into a
  // DIFFERENT drive (e.g. "Add shortcut to OneDrive"), even if it also
  // carries a `folder` facet. Never inspected beyond presence — its
  // existence alone is the signal to never recurse into it, since doing
  // so could scan a site nobody explicitly approved (ADR-0014).
  remoteItem?: unknown;
  parentReference: { driveId: string; siteId?: string; path: string };
  // Not always populated by Graph (tenant-dependent field visibility) —
  // consumers must treat these as best-effort, not guaranteed present.
  createdBy?: { user?: GraphDriveItemIdentity };
  lastModifiedBy?: { user?: GraphDriveItemIdentity };
}
