import { createTenantContext } from '@sph/database';
import { listSites, type GraphSite } from '@sph/graph-client';
import type { Job } from 'bullmq';
import type { DiscoveryJobPayload } from '@sph/types';
import { SiteDiscoveryProcessor } from './site-discovery.processor';

jest.mock('@sph/database');
jest.mock('@sph/graph-client');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;
const mockedListSites = listSites as jest.MockedFunction<typeof listSites>;

async function* asyncGen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

function job(payload: DiscoveryJobPayload): Job<DiscoveryJobPayload> {
  return { data: payload } as Job<DiscoveryJobPayload>;
}

function failedJob(
  payload: DiscoveryJobPayload,
  overrides: { attemptsMade: number; attempts: number },
): Job<DiscoveryJobPayload> {
  return {
    id: 'job-1',
    data: payload,
    attemptsMade: overrides.attemptsMade,
    opts: { attempts: overrides.attempts },
  } as Job<DiscoveryJobPayload>;
}

function graphSite(overrides: Partial<GraphSite> = {}): GraphSite {
  return { id: 'graph-site-1', webUrl: 'https://contoso.sharepoint.com/sites/finance', displayName: 'Finance', ...overrides };
}

describe('SiteDiscoveryProcessor', () => {
  const processor = new SiteDiscoveryProcessor();

  const microsoftTenants = { findFirstById: jest.fn(), updateById: jest.fn() };
  const sharePointSites = { findMany: jest.fn(), create: jest.fn(), updateById: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ microsoftTenants, sharePointSites } as never);

    microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', entraTenantId: 'entra-tenant-1' });
    sharePointSites.findMany.mockResolvedValue([]);
    mockedListSites.mockReturnValue(asyncGen([]));
  });

  const payload: DiscoveryJobPayload = { organizationId: 'org-1', microsoftTenantId: 'tenant-1' };

  it('returns early without touching the tenant when the MicrosoftTenant no longer exists', async () => {
    microsoftTenants.findFirstById.mockResolvedValue(null);

    await processor.process(job(payload));

    expect(microsoftTenants.updateById).not.toHaveBeenCalled();
  });

  it('sets discoveryStatus to Running before calling Graph', async () => {
    await processor.process(job(payload));

    expect(microsoftTenants.updateById).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ discoveryStatus: 'Running', discoveryStartedAt: expect.any(Date) }),
    );
  });

  it('creates a new SharePointSite record for a newly discovered site', async () => {
    mockedListSites.mockReturnValue(asyncGen([graphSite()]));

    await processor.process(job(payload));

    expect(sharePointSites.create).toHaveBeenCalledWith({
      microsoftTenantId: 'tenant-1',
      graphSiteId: 'graph-site-1',
      siteUrl: 'https://contoso.sharepoint.com/sites/finance',
      displayName: 'Finance',
    });
  });

  // Root cause regression test: getAllSites returns personal OneDrive sites
  // (isPersonalSite: true), an authoritative Graph field — outside this
  // product's scope, filtered here rather than in packages/graph-client
  // (ADR-0013's boundary: the Graph client returns raw data, this worker
  // decides what's product-relevant).
  it('skips a personal OneDrive site (isPersonalSite: true)', async () => {
    mockedListSites.mockReturnValue(asyncGen([graphSite({ isPersonalSite: true })]));

    await processor.process(job(payload));

    expect(sharePointSites.create).not.toHaveBeenCalled();
  });

  // No heuristic filtering: an unrecognized/system site (e.g. the tenant's
  // built-in Search Center, which has no isPersonalSite flag set) still
  // gets persisted as Discovered — a human decides via the existing
  // approval workflow, not a guessed exclusion rule (ADR-0014 §6).
  it('persists an unrecognized/system site as Discovered, same as any other site', async () => {
    mockedListSites.mockReturnValue(
      asyncGen([graphSite({ id: 'search-site', webUrl: 'https://contoso.sharepoint.com/search', displayName: 'https://contoso.sharepoint.com/search' })]),
    );

    await processor.process(job(payload));

    expect(sharePointSites.create).toHaveBeenCalledWith({
      microsoftTenantId: 'tenant-1',
      graphSiteId: 'search-site',
      siteUrl: 'https://contoso.sharepoint.com/search',
      displayName: 'https://contoso.sharepoint.com/search',
    });
  });

  it('does not duplicate an already-known site (idempotent, matched by graphSiteId)', async () => {
    sharePointSites.findMany.mockResolvedValue([
      { id: 'site-row-1', graphSiteId: 'graph-site-1', siteUrl: 'https://contoso.sharepoint.com/sites/finance', displayName: 'Finance' },
    ]);
    mockedListSites.mockReturnValue(asyncGen([graphSite()]));

    await processor.process(job(payload));

    expect(sharePointSites.create).not.toHaveBeenCalled();
  });

  it('preserves an existing approved site\'s status and approvedByUserId across rediscovery', async () => {
    sharePointSites.findMany.mockResolvedValue([
      {
        id: 'site-row-1',
        graphSiteId: 'graph-site-1',
        siteUrl: 'https://contoso.sharepoint.com/sites/finance',
        displayName: 'Finance',
        status: 'Approved',
        approvedByUserId: 'user-1',
        approvedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    mockedListSites.mockReturnValue(asyncGen([graphSite()]));

    await processor.process(job(payload));

    expect(sharePointSites.updateById).not.toHaveBeenCalled(); // nothing changed, so no write at all
    expect(sharePointSites.create).not.toHaveBeenCalled();
  });

  it('updates only siteUrl/displayName when Graph reports a rename or move, never status/approval fields', async () => {
    sharePointSites.findMany.mockResolvedValue([
      {
        id: 'site-row-1',
        graphSiteId: 'graph-site-1',
        siteUrl: 'https://contoso.sharepoint.com/sites/finance-old',
        displayName: 'Finance (Old)',
        status: 'Approved',
        approvedByUserId: 'user-1',
      },
    ]);
    mockedListSites.mockReturnValue(
      asyncGen([graphSite({ webUrl: 'https://contoso.sharepoint.com/sites/finance-new', displayName: 'Finance (New)' })]),
    );

    await processor.process(job(payload));

    expect(sharePointSites.updateById).toHaveBeenCalledWith('site-row-1', {
      siteUrl: 'https://contoso.sharepoint.com/sites/finance-new',
      displayName: 'Finance (New)',
    });
    const [, updateData] = sharePointSites.updateById.mock.calls[0] as [string, Record<string, unknown>];
    expect(updateData).not.toHaveProperty('status');
    expect(updateData).not.toHaveProperty('approvedByUserId');
    expect(updateData).not.toHaveProperty('approvedAt');
  });

  it('sets discoveryStatus to Completed and clears discoveryError on a successful run', async () => {
    mockedListSites.mockReturnValue(asyncGen([graphSite()]));

    await processor.process(job(payload));

    expect(microsoftTenants.updateById).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ discoveryStatus: 'Completed', discoveryCompletedAt: expect.any(Date), discoveryError: null }),
    );
  });

  it('propagates a Graph failure uncaught, so BullMQ can retry the whole job', async () => {
    mockedListSites.mockImplementation(() => {
      throw new Error('Graph unavailable');
    });

    await expect(processor.process(job(payload))).rejects.toThrow('Graph unavailable');
    expect(microsoftTenants.updateById).not.toHaveBeenCalledWith('tenant-1', expect.objectContaining({ discoveryStatus: 'Completed' }));
  });

  describe('onFailed (retry-exhaustion handling)', () => {
    it('does not mark discoveryStatus Failed while retries remain', async () => {
      await processor.onFailed(failedJob(payload, { attemptsMade: 1, attempts: 3 }), new Error('transient'));

      expect(microsoftTenants.updateById).not.toHaveBeenCalled();
    });

    it('marks discoveryStatus Failed once attemptsMade reaches the configured max', async () => {
      await processor.onFailed(failedJob(payload, { attemptsMade: 3, attempts: 3 }), new Error('Graph unavailable'));

      expect(microsoftTenants.updateById).toHaveBeenCalledWith('tenant-1', {
        discoveryStatus: 'Failed',
        discoveryCompletedAt: expect.any(Date),
        discoveryError: 'Graph unavailable',
      });
    });

    it('does nothing when the job is undefined', async () => {
      await processor.onFailed(undefined, new Error('unused'));

      expect(microsoftTenants.updateById).not.toHaveBeenCalled();
    });
  });
});
