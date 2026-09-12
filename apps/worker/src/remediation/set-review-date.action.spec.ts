import {
  listColumns,
  listContentTypes,
  listDrives,
  listItemDriveItemIds,
  listItemFields,
  updateListItemFields,
  GraphPermissionError,
  GraphNotFoundError,
  GraphThrottledError,
  GraphTransientError,
  GraphAuthenticationError,
} from '@sph/graph-client';
import type { Document, SharePointReviewDateMapping, SharePointSite, TenantContext } from '@sph/database';
import { executeSetReviewDateAction, type SetReviewDateActionContext } from './set-review-date.action';

// Partial mock, keeping the real error classes — a bare jest.mock('@sph/graph-client')
// replaces GraphClientError subclasses with auto-generated mocks that don't
// correctly extend Error (instanceof/message checks break on a mocking
// artifact, not this file's logic), matching review-date-sync.spec.ts's
// established precedent exactly.
jest.mock('@sph/graph-client', () => ({
  ...jest.requireActual('@sph/graph-client'),
  listColumns: jest.fn(),
  listContentTypes: jest.fn(),
  listDrives: jest.fn(),
  listItemFields: jest.fn(),
  listItemDriveItemIds: jest.fn(),
  updateListItemFields: jest.fn(),
}));

const mockedListColumns = listColumns as jest.MockedFunction<typeof listColumns>;
const mockedListContentTypes = listContentTypes as jest.MockedFunction<typeof listContentTypes>;
const mockedListDrives = listDrives as jest.MockedFunction<typeof listDrives>;
const mockedListItemFields = listItemFields as jest.MockedFunction<typeof listItemFields>;
const mockedListItemDriveItemIds = listItemDriveItemIds as jest.MockedFunction<typeof listItemDriveItemIds>;
const mockedUpdateListItemFields = updateListItemFields as jest.MockedFunction<typeof updateListItemFields>;

async function* asyncGen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function* asyncGenThatThrows<T>(error: unknown): AsyncGenerator<T> {
  throw error;
  yield undefined as never;
}

const dateColumn = { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', dateTime: {} };

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

const activeMapping: SharePointReviewDateMapping = {
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
} as SharePointReviewDateMapping;

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    organizationId: 'org-1',
    siteId: 'site-1',
    graphItemId: 'drive-item-1',
    graphListId: 'list-1',
    name: 'Report.docx',
    path: '/Report.docx',
    fileType: 'docx',
    webUrl: null,
    sizeBytes: BigInt(1024),
    sourceCreatedAt: new Date(),
    sourceModifiedAt: new Date(),
    status: 'Active',
    currentHealthScoreId: null,
    ingestedAt: new Date(),
    nextReviewDueAt: null,
    reviewDateSource: 'Manual',
    ...overrides,
  } as Document;
}

function makeContext(overrides: Record<string, unknown> = {}): SetReviewDateActionContext {
  const tenantContext = {
    organizationId: 'org-1',
    sharePointSites: { findFirstById: jest.fn().mockResolvedValue(site) },
    sharePointReviewDateMappings: { findByLibrary: jest.fn().mockResolvedValue(activeMapping) },
    ...overrides,
  } as unknown as TenantContext;

  return { entraTenantId: 'entra-1', tenantContext };
}

const payload = { nextReviewDueAt: '2026-12-01T00:00:00.000Z' };

describe('executeSetReviewDateAction (ADR-0022 Phase 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
    mockedListContentTypes.mockReturnValue(asyncGen([]));
    mockedUpdateListItemFields.mockResolvedValue(undefined);
    // Most tests below only care about the write/drive path; default the
    // verification sweep to "confirms the written value" so it's opt-out
    // per test rather than repeated everywhere.
    mockedListItemFields.mockReturnValue(asyncGen([{ id: 'listitem-1', fields: { ReviewDate: payload.nextReviewDueAt } }]));
    mockedListItemDriveItemIds.mockReturnValue(asyncGen([{ id: 'listitem-1', driveItem: { id: 'drive-item-1' } }]));
    mockedListDrives.mockReturnValue(asyncGen([{ id: 'drive-1', name: 'Documents', webUrl: 'https://x', driveType: 'documentLibrary', list: { id: 'list-1' } }]));
  });

  it('1. resolves the drive, PATCHes, and verifies — a fully successful run', async () => {
    const context = makeContext();

    const result = await executeSetReviewDateAction(context, makeDocument(), payload);

    expect(result).toEqual({ outcome: 'verified', verifiedReviewDate: new Date('2026-12-01T00:00:00.000Z') });
    expect(mockedUpdateListItemFields).toHaveBeenCalledTimes(1);
  });

  it('2. selects the correct drive when multiple drives exist under the site', async () => {
    mockedListDrives.mockReturnValue(
      asyncGen([
        { id: 'drive-other', name: 'Other', webUrl: 'https://x', driveType: 'documentLibrary', list: { id: 'list-other' } },
        { id: 'drive-1', name: 'Documents', webUrl: 'https://x', driveType: 'documentLibrary', list: { id: 'list-1' } },
      ]),
    );
    const context = makeContext();

    await executeSetReviewDateAction(context, makeDocument(), payload);

    expect(mockedUpdateListItemFields).toHaveBeenCalledWith('entra-1', 'drive-1', 'drive-item-1', expect.anything(), expect.anything());
  });

  it('3. throws GraphNotFoundError (permanent) when no drive matches the document\'s graphListId', async () => {
    mockedListDrives.mockReturnValue(
      asyncGen([{ id: 'drive-other', name: 'Other', webUrl: 'https://x', driveType: 'documentLibrary', list: { id: 'list-other' } }]),
    );
    const context = makeContext();

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toThrow(GraphNotFoundError);
    expect(mockedUpdateListItemFields).not.toHaveBeenCalled();
  });

  it('4. sends document.graphItemId as the itemId in the PATCH call', async () => {
    const context = makeContext();

    await executeSetReviewDateAction(context, makeDocument({ graphItemId: 'a-specific-drive-item-id' }), payload);

    expect(mockedUpdateListItemFields).toHaveBeenCalledWith(
      'entra-1',
      'drive-1',
      'a-specific-drive-item-id',
      expect.anything(),
      expect.anything(),
    );
  });

  it('5. uses the mapped column\'s current internal name as the PATCH field key, not its display name or a guess', async () => {
    // A renamed column: same columnDefinitionId (the stable key), but the
    // Graph-reported internal name has changed since confirmation — proves
    // this is re-resolved fresh, never cached from columnDisplayNameAtConfirmation.
    mockedListColumns.mockReturnValue(asyncGen([{ id: 'col-1', name: 'RenamedReviewDate', displayName: 'Next Review', dateTime: {} }]));
    mockedListItemFields.mockReturnValue(
      asyncGen([{ id: 'listitem-1', fields: { RenamedReviewDate: payload.nextReviewDueAt } }]),
    );
    const context = makeContext();

    const result = await executeSetReviewDateAction(context, makeDocument(), payload);

    expect(mockedUpdateListItemFields).toHaveBeenCalledWith(
      'entra-1',
      'drive-1',
      'drive-item-1',
      { RenamedReviewDate: payload.nextReviewDueAt },
      expect.anything(),
    );
    expect(mockedListItemFields).toHaveBeenCalledWith('entra-1', 'graph-site-1', 'list-1', 'RenamedReviewDate', expect.anything());
    expect(result).toEqual({ outcome: 'verified', verifiedReviewDate: new Date('2026-12-01T00:00:00.000Z') });
  });

  it('6. sends the exact payload.nextReviewDueAt value in the PATCH body', async () => {
    const context = makeContext();
    const distinctPayload = { nextReviewDueAt: '2027-03-15T00:00:00.000Z' };
    mockedListItemFields.mockReturnValue(asyncGen([{ id: 'listitem-1', fields: { ReviewDate: distinctPayload.nextReviewDueAt } }]));

    await executeSetReviewDateAction(context, makeDocument(), distinctPayload);

    expect(mockedUpdateListItemFields).toHaveBeenCalledWith(
      'entra-1',
      'drive-1',
      'drive-item-1',
      { ReviewDate: '2027-03-15T00:00:00.000Z' },
      expect.anything(),
    );
  });

  it('7. propagates GraphPermissionError from the PATCH call untouched', async () => {
    const error = new GraphPermissionError('Access denied', 'accessDenied', 'corr-1');
    mockedUpdateListItemFields.mockRejectedValue(error);
    const context = makeContext();

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toBe(error);
  });

  it('8. propagates GraphNotFoundError from the PATCH call untouched', async () => {
    const error = new GraphNotFoundError('Item not found', 'itemNotFound', 'corr-1');
    mockedUpdateListItemFields.mockRejectedValue(error);
    const context = makeContext();

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toBe(error);
  });

  it('9. propagates GraphThrottledError from the PATCH call untouched (retryable)', async () => {
    const error = new GraphThrottledError('Throttled', 'activityLimitReached', 'corr-1');
    mockedUpdateListItemFields.mockRejectedValue(error);
    const context = makeContext();

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toBe(error);
  });

  it('10. propagates GraphTransientError from the PATCH call untouched (retryable)', async () => {
    const error = new GraphTransientError('Bad gateway', 'internalServerError', 'corr-1');
    mockedUpdateListItemFields.mockRejectedValue(error);
    const context = makeContext();

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toBe(error);
  });

  it('11. propagates GraphAuthenticationError distinguishably — never coerced into GraphPermissionError or swallowed', async () => {
    const error = new GraphAuthenticationError('Access token is empty', 'InvalidAuthenticationToken', 'corr-1');
    mockedUpdateListItemFields.mockRejectedValue(error);
    const context = makeContext();

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toBe(error);
    await expect(executeSetReviewDateAction(context, makeDocument(), payload).catch((e) => e)).resolves.not.toBeInstanceOf(
      GraphPermissionError,
    );
  });

  it('12. returns {outcome: "unverified"} — never throws, never claims success — when the write succeeds but the re-fetch does not confirm the value', async () => {
    mockedListItemFields.mockReturnValue(asyncGen([{ id: 'listitem-1', fields: { ReviewDate: '2099-01-01T00:00:00.000Z' } }]));
    const context = makeContext();

    const result = await executeSetReviewDateAction(context, makeDocument(), payload);

    expect(result).toEqual({ outcome: 'unverified' });
    expect(mockedUpdateListItemFields).toHaveBeenCalledTimes(1); // the write itself still happened
  });

  it('12b. returns {outcome: "unverified"} when the re-fetch finds no row for this document at all', async () => {
    mockedListItemFields.mockReturnValue(asyncGen([]));
    mockedListItemDriveItemIds.mockReturnValue(asyncGen([]));
    const context = makeContext();

    const result = await executeSetReviewDateAction(context, makeDocument(), payload);

    expect(result).toEqual({ outcome: 'unverified' });
  });

  it('13. confirms the intended date after normalization — verified even when Graph\'s returned string format differs (no milliseconds) from what was written', async () => {
    mockedListItemFields.mockReturnValue(asyncGen([{ id: 'listitem-1', fields: { ReviewDate: '2026-12-01T00:00:00Z' } }])); // no .000
    const context = makeContext();

    const result = await executeSetReviewDateAction(context, makeDocument(), payload); // payload has .000Z

    expect(result).toEqual({ outcome: 'verified', verifiedReviewDate: new Date('2026-12-01T00:00:00.000Z') });
  });

  it('14. a propagated Graph error preserves the correlationId this action was given and threaded through every call', async () => {
    mockedUpdateListItemFields.mockImplementation(async (_tenant, _drive, _item, _fields, options) => {
      throw new GraphPermissionError('Access denied', 'accessDenied', options?.correlationId);
    });
    const context: SetReviewDateActionContext = { ...makeContext(), correlationId: 'caller-supplied-corr-id' };

    const caught = (await executeSetReviewDateAction(context, makeDocument(), payload).catch((e) => e)) as GraphPermissionError;

    expect(caught.correlationId).toBe('caller-supplied-corr-id');
    expect(mockedListDrives).toHaveBeenCalledWith(
      'entra-1',
      'graph-site-1',
      expect.objectContaining({ correlationId: 'caller-supplied-corr-id' }),
    );
  });

  it('generates its own correlationId when the caller does not supply one, and threads it through every Graph call', async () => {
    const context = makeContext();

    await executeSetReviewDateAction(context, makeDocument(), payload);

    const patchCallOptions = mockedUpdateListItemFields.mock.calls[0]?.[4];
    expect(patchCallOptions?.correlationId).toEqual(expect.any(String));
    expect(mockedListDrives).toHaveBeenCalledWith('entra-1', 'graph-site-1', expect.objectContaining({ correlationId: patchCallOptions?.correlationId }));
  });

  it('throws a plain (non-Graph) Error, not a GraphClientError, when the document has no graphListId', async () => {
    const context = makeContext();

    const caught = await executeSetReviewDateAction(context, makeDocument({ graphListId: null }), payload).catch((e) => e as Error);

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(GraphPermissionError);
    expect(mockedListDrives).not.toHaveBeenCalled();
  });

  it('throws a plain Error when no SharePointSite is found for the document', async () => {
    const context = makeContext({
      sharePointSites: { findFirstById: jest.fn().mockResolvedValue(null) },
    });

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toThrow(/SharePointSite/);
  });

  it('throws a plain Error when no Active SharePointReviewDateMapping exists for the library', async () => {
    const context = makeContext({
      sharePointReviewDateMappings: { findByLibrary: jest.fn().mockResolvedValue(null) },
    });

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toThrow(/mapping/i);
    expect(mockedListColumns).not.toHaveBeenCalled();
  });

  it('throws a plain Error when the mapping exists but is Stale, not Active', async () => {
    const context = makeContext({
      sharePointReviewDateMappings: { findByLibrary: jest.fn().mockResolvedValue({ ...activeMapping, status: 'Stale' }) },
    });

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toThrow(/mapping/i);
  });

  it('throws a plain Error when the mapped columnDefinitionId no longer resolves against current columns', async () => {
    mockedListColumns.mockReturnValue(asyncGen([])); // the column was deleted
    const context = makeContext();

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toThrow(/no longer resolves/);
    expect(mockedUpdateListItemFields).not.toHaveBeenCalled();
  });

  it('propagates a Graph error from the drive-listing read (listDrives) untouched', async () => {
    const error = new GraphThrottledError('Throttled', 'activityLimitReached', 'corr-1');
    mockedListDrives.mockReturnValue(asyncGenThatThrows(error));
    const context = makeContext();

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toBe(error);
  });

  it('propagates a Graph error from the verification read (listItemFields, after a successful write) untouched — never folded into "unverified"', async () => {
    const error = new GraphTransientError('Bad gateway', 'internalServerError', 'corr-1');
    mockedListItemFields.mockReturnValue(asyncGenThatThrows(error));
    const context = makeContext();

    await expect(executeSetReviewDateAction(context, makeDocument(), payload)).rejects.toBe(error);
    expect(mockedUpdateListItemFields).toHaveBeenCalledTimes(1); // the write itself did happen
  });
});
