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
