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
  parentReference: { driveId: string; siteId?: string; path: string };
  // Not always populated by Graph (tenant-dependent field visibility) —
  // consumers must treat these as best-effort, not guaranteed present.
  createdBy?: { user?: GraphDriveItemIdentity };
  lastModifiedBy?: { user?: GraphDriveItemIdentity };
}
