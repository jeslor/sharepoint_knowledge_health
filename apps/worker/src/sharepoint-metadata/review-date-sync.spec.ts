import { listColumns, listContentTypes, listItemFields, listItemDriveItemIds, GraphThrottledError } from '@sph/graph-client';
import type { SharePointSite, TenantContext } from '@sph/database';
import { syncConfirmedReviewDateMapping } from './review-date-sync';

// Partial mock, not a bare automock — a full jest.mock('@sph/graph-client')
// replaces GraphThrottledError/GraphClientError with auto-generated mock
// constructors that don't correctly extend the real Error prototype chain
// (their .message is never set, and `instanceof Error` fails), which broke
// the error-type/message assertions below against a mocking artifact, not
// against this file's actual logic. Keeping the real error classes while
// still mocking the four Graph functions this suite controls avoids that.
jest.mock('@sph/graph-client', () => ({
  ...jest.requireActual('@sph/graph-client'),
  listColumns: jest.fn(),
  listContentTypes: jest.fn(),
  listItemFields: jest.fn(),
  listItemDriveItemIds: jest.fn(),
}));

const mockedListColumns = listColumns as jest.MockedFunction<typeof listColumns>;
const mockedListContentTypes = listContentTypes as jest.MockedFunction<typeof listContentTypes>;
const mockedListItemFields = listItemFields as jest.MockedFunction<typeof listItemFields>;
const mockedListItemDriveItemIds = listItemDriveItemIds as jest.MockedFunction<typeof listItemDriveItemIds>;

async function* asyncGen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function* asyncGenThatThrows<T>(error: unknown): AsyncGenerator<T> {
  throw error;
  yield undefined as never;
}

const site: SharePointSite = {
  id: 'site-1',
  organizationId: 'org-1',
  microsoftTenantId: 'tenant-1',
  graphSiteId: 'graph-site-1',
  siteUrl: 'https://contoso.sharepoint.com/sites/finance',
  displayName: 'Finance',
  status: 'Approved',
  approvedAt: new Date(),
  approvedByUserId: 'user-1',
  lastScannedAt: null,
  createdAt: new Date(),
} as SharePointSite;

const dateColumn = { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', dateTime: {} };

function makeContext(overrides: Record<string, unknown> = {}): TenantContext {
  return {
    organizationId: 'org-1',
    sharePointReviewDateMappings: { findByLibrary: jest.fn(), updateById: jest.fn() },
    documents: { findMany: jest.fn().mockResolvedValue([]), updateById: jest.fn() },
    ...overrides,
  } as unknown as TenantContext;
}

const logger = { error: jest.fn(), log: jest.fn() };

describe('syncConfirmedReviewDateMapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Most tests care only about the fields sweep; default the driveItem
    // sweep to empty so it's opt-in per test rather than repeated everywhere.
    mockedListItemDriveItemIds.mockReturnValue(asyncGen([]));
  });

  it('is a no-op — makes no Graph calls — when no mapping is confirmed for this library', async () => {
    const context = makeContext();
    (context.sharePointReviewDateMappings.findByLibrary as jest.Mock).mockResolvedValue(null);

    await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

    expect(mockedListColumns).not.toHaveBeenCalled();
    expect(mockedListItemFields).not.toHaveBeenCalled();
    expect(mockedListItemDriveItemIds).not.toHaveBeenCalled();
  });

  describe('with an active confirmed mapping', () => {
    const mapping = {
      id: 'mapping-1',
      organizationId: 'org-1',
      siteId: 'site-1',
      graphListId: 'list-1',
      columnDefinitionId: 'col-1',
      columnDisplayNameAtConfirmation: 'Review Date',
      status: 'Active',
      staleDetectedAt: null,
      confirmedByUserId: 'user-1',
      confirmedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    function contextWithMapping(): TenantContext {
      const context = makeContext();
      (context.sharePointReviewDateMappings.findByLibrary as jest.Mock).mockResolvedValue(mapping);
      return context;
    }

    it('requests fields and driveItem via two separate calls, never one combined $expand', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGen([]));

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(mockedListItemFields).toHaveBeenCalledWith(
        'entra-1',
        'graph-site-1',
        'list-1',
        'ReviewDate',
        expect.objectContaining({ correlationId: expect.any(String) }),
      );
      expect(mockedListItemDriveItemIds).toHaveBeenCalledWith(
        'entra-1',
        'graph-site-1',
        'list-1',
        expect.objectContaining({ correlationId: expect.any(String) }),
      );
    });

    it('writes nextReviewDueAt/reviewDateSource: GraphMetadata when the mapped column has a valid value, joined by listItem id', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGen([{ id: '1', fields: { ReviewDate: '2026-12-01' } }]));
      mockedListItemDriveItemIds.mockReturnValue(asyncGen([{ id: '1', driveItem: { id: 'drive-item-1' } }]));
      (context.documents.findMany as jest.Mock).mockResolvedValue([
        { id: 'doc-1', nextReviewDueAt: null, reviewDateSource: 'Manual' },
      ]);

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.updateById).toHaveBeenCalledWith('doc-1', {
        nextReviewDueAt: new Date('2026-12-01'),
        reviewDateSource: 'GraphMetadata',
      });
    });

    it('supersedes a previously Manual value once the mapping is confirmed — the intended precedence (ADR-0016 §17.1)', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGen([{ id: '1', fields: { ReviewDate: '2026-12-01' } }]));
      mockedListItemDriveItemIds.mockReturnValue(asyncGen([{ id: '1', driveItem: { id: 'drive-item-1' } }]));
      (context.documents.findMany as jest.Mock).mockResolvedValue([
        { id: 'doc-1', nextReviewDueAt: new Date('2026-01-01'), reviewDateSource: 'Manual' },
      ]);

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.updateById).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ reviewDateSource: 'GraphMetadata' }),
      );
    });

    it('never alters a Manual value when no mapping is confirmed (no mapping = no Graph call at all)', async () => {
      const context = makeContext();
      (context.sharePointReviewDateMappings.findByLibrary as jest.Mock).mockResolvedValue(null);

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.findMany).not.toHaveBeenCalled();
      expect(context.documents.updateById).not.toHaveBeenCalled();
    });

    it('does not write when the SharePoint value is unchanged from what is already stored (idempotent)', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGen([{ id: '1', fields: { ReviewDate: '2026-12-01' } }]));
      mockedListItemDriveItemIds.mockReturnValue(asyncGen([{ id: '1', driveItem: { id: 'drive-item-1' } }]));
      (context.documents.findMany as jest.Mock).mockResolvedValue([
        { id: 'doc-1', nextReviewDueAt: new Date('2026-12-01'), reviewDateSource: 'GraphMetadata' },
      ]);

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.updateById).not.toHaveBeenCalled();
    });

    it('skips a row whose column value is empty — falls through, never writes null over an existing value', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGen([{ id: '1', fields: {} }]));
      mockedListItemDriveItemIds.mockReturnValue(asyncGen([{ id: '1', driveItem: { id: 'drive-item-1' } }]));
      (context.documents.findMany as jest.Mock).mockResolvedValue([
        { id: 'doc-1', nextReviewDueAt: new Date('2026-01-01'), reviewDateSource: 'Manual' },
      ]);

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.updateById).not.toHaveBeenCalled();
    });

    it('skips a row with a malformed date value — never writes a bad date', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGen([{ id: '1', fields: { ReviewDate: 'not-a-date' } }]));
      mockedListItemDriveItemIds.mockReturnValue(asyncGen([{ id: '1', driveItem: { id: 'drive-item-1' } }]));
      (context.documents.findMany as jest.Mock).mockResolvedValue([{ id: 'doc-1' }]);

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.updateById).not.toHaveBeenCalled();
    });

    it('skips a row whose listItem id has no match in the driveItem sweep', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGen([{ id: '1', fields: { ReviewDate: '2026-12-01' } }]));
      mockedListItemDriveItemIds.mockReturnValue(asyncGen([])); // no matching row at all

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.findMany).not.toHaveBeenCalled();
      expect(context.documents.updateById).not.toHaveBeenCalled();
    });

    it('skips a row whose driveItem sweep entry has no driveItem (e.g. list-only item)', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGen([{ id: '1', fields: { ReviewDate: '2026-12-01' } }]));
      mockedListItemDriveItemIds.mockReturnValue(asyncGen([{ id: '1' }])); // present, but no driveItem facet

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.updateById).not.toHaveBeenCalled();
    });

    it('joins correctly across pages/order — driveItem sweep returned in a different order than fields sweep', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(
        asyncGen([
          { id: '1', fields: { ReviewDate: '2026-12-01' } },
          { id: '2', fields: { ReviewDate: '2026-12-02' } },
        ]),
      );
      // Deliberately reversed order relative to the fields sweep.
      mockedListItemDriveItemIds.mockReturnValue(
        asyncGen([
          { id: '2', driveItem: { id: 'drive-item-2' } },
          { id: '1', driveItem: { id: 'drive-item-1' } },
        ]),
      );
      (context.documents.findMany as jest.Mock).mockImplementation(async ({ where }: { where: { graphItemId: string } }) => [
        { id: `doc-for-${where.graphItemId}`, nextReviewDueAt: null, reviewDateSource: 'Manual' },
      ]);

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.updateById).toHaveBeenCalledWith(
        'doc-for-drive-item-1',
        expect.objectContaining({ nextReviewDueAt: new Date('2026-12-01') }),
      );
      expect(context.documents.updateById).toHaveBeenCalledWith(
        'doc-for-drive-item-2',
        expect.objectContaining({ nextReviewDueAt: new Date('2026-12-02') }),
      );
    });

    it('re-resolves the column by id every run, using the CURRENT name even if it changed (rename-safe)', async () => {
      const context = contextWithMapping();
      const renamedColumn = { id: 'col-1', name: 'ReviewDateRenamed', displayName: 'New Name', dateTime: {} };
      mockedListColumns.mockReturnValue(asyncGen([renamedColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGen([]));

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(mockedListItemFields).toHaveBeenCalledWith(
        'entra-1',
        'graph-site-1',
        'list-1',
        'ReviewDateRenamed',
        expect.objectContaining({ correlationId: expect.any(String) }),
      );
    });

    it('unions content-type columns with list columns when resolving the mapped column', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([]));
      mockedListContentTypes.mockReturnValue(asyncGen([{ id: 'ct-1', name: 'Document', columns: [dateColumn] }]));
      mockedListItemFields.mockReturnValue(asyncGen([]));

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(mockedListItemFields).toHaveBeenCalledWith(
        'entra-1',
        'graph-site-1',
        'list-1',
        'ReviewDate',
        expect.objectContaining({ correlationId: expect.any(String) }),
      );
    });

    it('flags the mapping Stale and touches no Document when the mapped column no longer resolves (deleted)', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([])); // column gone
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.sharePointReviewDateMappings.updateById).toHaveBeenCalledWith(
        'mapping-1',
        expect.objectContaining({ status: 'Stale' }),
      );
      expect(mockedListItemFields).not.toHaveBeenCalled();
      expect(mockedListItemDriveItemIds).not.toHaveBeenCalled();
      expect(context.documents.updateById).not.toHaveBeenCalled();
    });

    it('does not re-write Stale status on every run once already Stale (avoids redundant writes)', async () => {
      const context = makeContext();
      (context.sharePointReviewDateMappings.findByLibrary as jest.Mock).mockResolvedValue({
        ...mapping,
        status: 'Stale',
      });
      mockedListColumns.mockReturnValue(asyncGen([]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.sharePointReviewDateMappings.updateById).not.toHaveBeenCalled();
    });

    it('recovers a Stale mapping back to Active once the column resolves again', async () => {
      const context = makeContext();
      (context.sharePointReviewDateMappings.findByLibrary as jest.Mock).mockResolvedValue({
        ...mapping,
        status: 'Stale',
        staleDetectedAt: new Date('2026-01-01'),
      });
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGen([]));

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.sharePointReviewDateMappings.updateById).toHaveBeenCalledWith('mapping-1', {
        status: 'Active',
        staleDetectedAt: null,
      });
    });

    it('preserves last-known document values and does not touch mapping status on a column-discovery Graph failure', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGenThatThrows(new GraphThrottledError('Throttled')));

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.sharePointReviewDateMappings.updateById).not.toHaveBeenCalled();
      expect(context.documents.updateById).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('preserves last-known document values on a listItemFields (value retrieval) Graph failure', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGenThatThrows(new GraphThrottledError('Throttled')));

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.updateById).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('preserves last-known document values on a listItemDriveItemIds (correlation) Graph failure', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(asyncGen([{ id: '1', fields: { ReviewDate: '2026-12-01' } }]));
      mockedListItemDriveItemIds.mockReturnValue(asyncGenThatThrows(new GraphThrottledError('Throttled')));

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.updateById).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('does not throw — the caller (the scan) must never fail because of a metadata sync failure', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGenThatThrows(new Error('boom')));

      await expect(syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger)).resolves.not.toThrow();
    });

    it('processes multiple rows across a paginated sweep — the flat, non-N+1 mechanism', async () => {
      const context = contextWithMapping();
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      mockedListItemFields.mockReturnValue(
        asyncGen([
          { id: '1', fields: { ReviewDate: '2026-12-01' } },
          { id: '2', fields: { ReviewDate: '2026-12-02' } },
        ]),
      );
      mockedListItemDriveItemIds.mockReturnValue(
        asyncGen([
          { id: '1', driveItem: { id: 'drive-item-1' } },
          { id: '2', driveItem: { id: 'drive-item-2' } },
        ]),
      );
      (context.documents.findMany as jest.Mock)
        .mockResolvedValueOnce([{ id: 'doc-1', nextReviewDueAt: null, reviewDateSource: 'Manual' }])
        .mockResolvedValueOnce([{ id: 'doc-2', nextReviewDueAt: null, reviewDateSource: 'Manual' }]);

      await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

      expect(context.documents.updateById).toHaveBeenCalledTimes(2);
    });

    describe('Phase 1.2 — structured logging and correlationId', () => {
      it('emits one success log line with organizationId, siteId, graphListId, status, and counts on a successful sync', async () => {
        const context = contextWithMapping();
        mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
        mockedListContentTypes.mockReturnValue(asyncGen([]));
        mockedListItemFields.mockReturnValue(
          asyncGen([
            { id: '1', fields: { ReviewDate: '2026-12-01' } },
            { id: '2', fields: {} }, // empty — should count toward documentsSkippedEmpty
          ]),
        );
        mockedListItemDriveItemIds.mockReturnValue(
          asyncGen([
            { id: '1', driveItem: { id: 'drive-item-1' } },
            { id: '2', driveItem: { id: 'drive-item-2' } },
          ]),
        );
        (context.documents.findMany as jest.Mock).mockResolvedValue([
          { id: 'doc-1', nextReviewDueAt: null, reviewDateSource: 'Manual' },
        ]);

        await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

        expect(logger.log).toHaveBeenCalledTimes(1);
        const [message] = (logger.log as jest.Mock).mock.calls[0] as [string];
        expect(message).toContain('ReviewDateSync succeeded');
        expect(message).toContain('organizationId=org-1');
        expect(message).toContain('siteId=site-1');
        expect(message).toContain('graphListId=list-1');
        expect(message).toContain('status=Active');
        expect(message).toContain('documentsEvaluated=2');
        expect(message).toContain('documentsUpdated=1');
        expect(message).toContain('documentsSkippedEmpty=1');
        expect(message).toMatch(/durationMs=\d+/);
        expect(logger.error).not.toHaveBeenCalled();
      });

      it('never logs document names or field values — only ids, counts, and status', async () => {
        const context = contextWithMapping();
        mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
        mockedListContentTypes.mockReturnValue(asyncGen([]));
        mockedListItemFields.mockReturnValue(asyncGen([{ id: '1', fields: { ReviewDate: '2026-12-01' } }]));
        mockedListItemDriveItemIds.mockReturnValue(asyncGen([{ id: '1', driveItem: { id: 'drive-item-1' } }]));
        (context.documents.findMany as jest.Mock).mockResolvedValue([
          { id: 'doc-1', name: 'Confidential Salary Review.docx', nextReviewDueAt: null, reviewDateSource: 'Manual' },
        ]);

        await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

        const [message] = (logger.log as jest.Mock).mock.calls[0] as [string];
        expect(message).not.toContain('Confidential Salary Review');
        expect(message).not.toContain('2026-12-01');
      });

      it('emits a success log (status=Stale) rather than an error when the mapped column no longer resolves', async () => {
        const context = contextWithMapping();
        mockedListColumns.mockReturnValue(asyncGen([]));
        mockedListContentTypes.mockReturnValue(asyncGen([]));

        await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

        expect(logger.error).not.toHaveBeenCalled();
        const [message] = (logger.log as jest.Mock).mock.calls[0] as [string];
        expect(message).toContain('status=Stale');
        expect(message).toContain('documentsEvaluated=0');
      });

      it('emits an error log with operation name, errorType, and correlationId on a column-discovery Graph failure', async () => {
        const context = contextWithMapping();
        mockedListColumns.mockReturnValue(asyncGenThatThrows(new GraphThrottledError('Throttled')));

        await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

        expect(logger.log).not.toHaveBeenCalled();
        const [message] = (logger.error as jest.Mock).mock.calls[0] as [string];
        expect(message).toContain('ReviewDateSync failed');
        expect(message).toContain('operation=columnDiscovery');
        expect(message).toContain('errorType=GraphThrottledError');
        expect(message).toMatch(/correlationId=[0-9a-f-]{36}/);
      });

      it('emits an error log with operation=valueRetrieval on a listItemFields failure', async () => {
        const context = contextWithMapping();
        mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
        mockedListContentTypes.mockReturnValue(asyncGen([]));
        mockedListItemFields.mockReturnValue(asyncGenThatThrows(new GraphThrottledError('Throttled')));

        await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

        const [message] = (logger.error as jest.Mock).mock.calls[0] as [string];
        expect(message).toContain('operation=valueRetrieval');
      });

      it('passes the same correlationId to every review-date Graph call made during one sync', async () => {
        const context = contextWithMapping();
        mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
        mockedListContentTypes.mockReturnValue(asyncGen([]));
        mockedListItemFields.mockReturnValue(asyncGen([]));

        await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

        const columnsCallOptions = mockedListColumns.mock.calls[0]?.[3] as { correlationId?: string } | undefined;
        const contentTypesCallOptions = mockedListContentTypes.mock.calls[0]?.[3] as { correlationId?: string } | undefined;
        const fieldsCallOptions = mockedListItemFields.mock.calls[0]?.[4] as { correlationId?: string } | undefined;
        const driveItemCallOptions = mockedListItemDriveItemIds.mock.calls[0]?.[3] as { correlationId?: string } | undefined;

        expect(columnsCallOptions?.correlationId).toBeDefined();
        expect(columnsCallOptions?.correlationId).toBe(contentTypesCallOptions?.correlationId);
        expect(columnsCallOptions?.correlationId).toBe(fieldsCallOptions?.correlationId);
        expect(columnsCallOptions?.correlationId).toBe(driveItemCallOptions?.correlationId);
      });

      it('does not log anything when there is no confirmed mapping (the common, expected case)', async () => {
        const context = makeContext();
        (context.sharePointReviewDateMappings.findByLibrary as jest.Mock).mockResolvedValue(null);

        await syncConfirmedReviewDateMapping(context, 'entra-1', site, 'list-1', logger);

        expect(logger.log).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
      });
    });
  });
});
