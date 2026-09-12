import { REQUIRED_GRAPH_PERMISSIONS, REQUIRED_PERMISSION_VERSION } from './graph-permissions';

describe('REQUIRED_GRAPH_PERMISSIONS (ADR-0003 amendment / ADR-0022 write-back MVP)', () => {
  it('requires the two read scopes for scanning', () => {
    expect(REQUIRED_GRAPH_PERMISSIONS.read).toEqual(['Files.Read.All', 'Sites.Read.All']);
  });

  it('requires Sites.ReadWrite.All for review-date write-back', () => {
    expect(REQUIRED_GRAPH_PERMISSIONS.write).toContain('Sites.ReadWrite.All');
  });

  it('does NOT require Files.ReadWrite.All — write-back only touches SharePoint list-item fields, never file content (least privilege)', () => {
    const all = [...REQUIRED_GRAPH_PERMISSIONS.read, ...REQUIRED_GRAPH_PERMISSIONS.write];
    expect(all).not.toContain('Files.ReadWrite.All');
  });

  it('is at permission version 2 — the version that added the write scope, so v1-only tenants correctly require re-consent', () => {
    expect(REQUIRED_PERMISSION_VERSION).toBe(2);
  });
});
