import { BadRequestException, ConflictException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import { listColumns, listContentTypes, listDrives, GraphThrottledError } from '@sph/graph-client';
import { SharePointMetadataService } from './sharepoint-metadata.service';

jest.mock('@sph/database');
// Partial mock, not a bare automock — see the identical fix/rationale in
// apps/worker's review-date-sync.spec.ts: a full jest.mock('@sph/graph-client')
// replaces GraphThrottledError with a mock constructor that doesn't
// correctly extend Error, breaking error-type/message assertions against
// a mocking artifact rather than this file's actual logic.
jest.mock('@sph/graph-client', () => ({
  ...jest.requireActual('@sph/graph-client'),
  listColumns: jest.fn(),
  listContentTypes: jest.fn(),
  listDrives: jest.fn(),
}));

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;
const mockedListColumns = listColumns as jest.MockedFunction<typeof listColumns>;
const mockedListContentTypes = listContentTypes as jest.MockedFunction<typeof listContentTypes>;
const mockedListDrives = listDrives as jest.MockedFunction<typeof listDrives>;

async function* asyncGen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function* asyncGenThatThrows<T>(error: unknown): AsyncGenerator<T> {
  throw error;
  yield undefined as never;
}

const dateColumn = { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', dateTime: {} };

describe('SharePointMetadataService', () => {
  const service = new SharePointMetadataService();

  const sharePointSites = { findFirstById: jest.fn() };
  const microsoftTenants = { findFirstById: jest.fn() };
  const sharePointReviewDateMappings = { upsertActive: jest.fn(), findManyBySite: jest.fn() };
  const sharePointClassificationFields = {
    upsertActive: jest.fn(),
    findManyBySite: jest.fn(),
    findManyActiveByLibrary: jest.fn(),
    deleteById: jest.fn(),
  };
  const users = { findFirstById: jest.fn() };

  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockedCreateContext.mockReturnValue({
      sharePointSites,
      microsoftTenants,
      sharePointReviewDateMappings,
      sharePointClassificationFields,
      users,
    } as never);

    sharePointSites.findFirstById.mockResolvedValue({ id: 'site-1', microsoftTenantId: 'tenant-1', graphSiteId: 'graph-site-1' });
    microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', entraTenantId: 'entra-1' });
    users.findFirstById.mockResolvedValue({ id: 'user-1', displayName: 'Alice Admin' });
    sharePointReviewDateMappings.findManyBySite.mockResolvedValue([]);
    sharePointReviewDateMappings.upsertActive.mockResolvedValue({
      id: 'mapping-1',
      siteId: 'site-1',
      graphListId: 'list-1',
      columnDefinitionId: 'col-1',
      columnDisplayNameAtConfirmation: 'Review Date',
      status: 'Active',
      confirmedByUserId: 'user-1',
      confirmedAt: new Date('2026-08-10'),
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('throws 404 when the site does not exist in this organization', async () => {
    sharePointSites.findFirstById.mockResolvedValue(null);

    await expect(
      service.confirmReviewDateMapping('org-1', 'site-missing', 'list-1', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws 404 when the MicrosoftTenant no longer exists', async () => {
    microsoftTenants.findFirstById.mockResolvedValue(null);

    await expect(service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws 400 when no dateTime candidate exists — never silently activates', async () => {
    mockedListColumns.mockReturnValue(asyncGen([{ id: 'col-2', name: 'Title', displayName: 'Title' }]));
    mockedListContentTypes.mockReturnValue(asyncGen([]));

    await expect(service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(sharePointReviewDateMappings.upsertActive).not.toHaveBeenCalled();
  });

  it('throws 409 when multiple dateTime candidates exist — detected but inert, never guessed', async () => {
    mockedListColumns.mockReturnValue(
      asyncGen([dateColumn, { id: 'col-2', name: 'NextReview', displayName: 'Next Review', dateTime: {} }]),
    );
    mockedListContentTypes.mockReturnValue(asyncGen([]));

    await expect(service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1')).rejects.toThrow(
      ConflictException,
    );
    expect(sharePointReviewDateMappings.upsertActive).not.toHaveBeenCalled();
  });

  describe('Phase 2 — explicit candidate selection for the multiple-candidates case', () => {
    const nextReviewColumn = { id: 'col-2', name: 'NextReview', displayName: 'Next Review', dateTime: {} };

    it('confirms the selected column when an explicit columnDefinitionId matches a current candidate', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn, nextReviewColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1', 'col-2');

      expect(sharePointReviewDateMappings.upsertActive).toHaveBeenCalledWith(
        expect.objectContaining({ columnDefinitionId: 'col-2', columnDisplayNameAtConfirmation: 'Next Review' }),
      );
    });

    it('still throws 409 when no selection is provided, even though a valid selection exists', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn, nextReviewColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await expect(service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(sharePointReviewDateMappings.upsertActive).not.toHaveBeenCalled();
    });

    it('rejects a selection that does not match any current candidate — never falls back to guessing', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn, nextReviewColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await expect(
        service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1', 'col-does-not-exist'),
      ).rejects.toThrow(BadRequestException);
      expect(sharePointReviewDateMappings.upsertActive).not.toHaveBeenCalled();
    });

    it('rejects a selection that no longer matches after the candidate set changed since an earlier eligibility check', async () => {
      // Simulates: admin saw {ReviewDate, NextReview} in an earlier eligibility
      // call, but by the time they confirm, NextReview has been deleted —
      // the server must re-validate against the CURRENT set, never trust
      // what the client remembered.
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await expect(
        service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1', 'col-2'),
      ).rejects.toThrow(BadRequestException);
      expect(sharePointReviewDateMappings.upsertActive).not.toHaveBeenCalled();
    });

    it('ignores a superfluous but correct selection in the single-candidate case', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1', 'col-1');

      expect(sharePointReviewDateMappings.upsertActive).toHaveBeenCalledWith(
        expect.objectContaining({ columnDefinitionId: 'col-1' }),
      );
    });

    it('rejects a selection that does not match the single actual candidate', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await expect(
        service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1', 'col-wrong'),
      ).rejects.toThrow(BadRequestException);
      expect(sharePointReviewDateMappings.upsertActive).not.toHaveBeenCalled();
    });
  });

  it('activates the single unambiguous candidate via an atomic upsert', async () => {
    mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
    mockedListContentTypes.mockReturnValue(asyncGen([]));

    const result = await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1');

    expect(sharePointReviewDateMappings.upsertActive).toHaveBeenCalledWith({
      siteId: 'site-1',
      graphListId: 'list-1',
      columnDefinitionId: 'col-1',
      columnDisplayNameAtConfirmation: 'Review Date',
      confirmedByUserId: 'user-1',
    });
    expect(result.status).toBe('Active');
    expect(result.columnDefinitionId).toBe('col-1');
  });

  it('re-confirming an already-mapped library delegates to the same idempotent upsert — never a separate create/update branch', async () => {
    // mockImplementation (a factory), not mockReturnValue (a single shared
    // instance) — an async generator is single-use, and this test invokes
    // the service twice, each needing its own fresh iteration.
    mockedListColumns.mockImplementation(() => asyncGen([dateColumn]));
    mockedListContentTypes.mockImplementation(() => asyncGen([]));

    await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1');
    await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-2');

    expect(sharePointReviewDateMappings.upsertActive).toHaveBeenCalledTimes(2);
    // The service never branches on "does a mapping already exist" itself —
    // that decision is the repository's atomic upsert's responsibility,
    // which is exactly what removes the race the code review identified.
  });

  it('propagates whatever row the repository atomic upsert resolves to, including under a simulated race (repository resolves both callers to the same row)', async () => {
    mockedListColumns.mockImplementation(() => asyncGen([dateColumn]));
    mockedListContentTypes.mockImplementation(() => asyncGen([]));
    const racedMapping = {
      id: 'mapping-shared',
      siteId: 'site-1',
      graphListId: 'list-1',
      columnDefinitionId: 'col-1',
      columnDisplayNameAtConfirmation: 'Review Date',
      status: 'Active',
      confirmedByUserId: 'user-1',
      confirmedAt: new Date('2026-08-10'),
    };
    sharePointReviewDateMappings.upsertActive.mockResolvedValue(racedMapping);

    const [first, second] = await Promise.all([
      service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1'),
      service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-2'),
    ]);

    expect(first.id).toBe('mapping-shared');
    expect(second.id).toBe('mapping-shared');
  });

  it('unions content-type columns when determining candidates', async () => {
    mockedListColumns.mockReturnValue(asyncGen([]));
    mockedListContentTypes.mockReturnValue(asyncGen([{ id: 'ct-1', name: 'Document', columns: [dateColumn] }]));

    const result = await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1');

    expect(result.columnDefinitionId).toBe('col-1');
  });

  it('throws 503 when live Graph discovery fails', async () => {
    mockedListColumns.mockReturnValue(asyncGenThatThrows(new GraphThrottledError('Throttled')));

    await expect(service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  describe('Phase 1.1 — system-column exclusion, wired through the shared package', () => {
    const createdColumn = { id: 'sys-1', name: 'Created', displayName: 'Created', dateTime: {}, isDeletable: false };
    const modifiedColumn = { id: 'sys-2', name: 'Modified', displayName: 'Modified', dateTime: {}, isDeletable: false };

    it('confirms successfully against the exact live-validation scenario — {Created, Modified, ReviewDate}, previously always rejected as ambiguous', async () => {
      mockedListColumns.mockReturnValue(asyncGen([createdColumn, modifiedColumn, dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      const result = await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1');

      expect(sharePointReviewDateMappings.upsertActive).toHaveBeenCalledWith(
        expect.objectContaining({ columnDefinitionId: 'col-1' }),
      );
      expect(result.columnDefinitionId).toBe('col-1');
    });
  });

  describe('checkReviewDateEligibility', () => {
    it('throws 404 when the site does not exist in this organization', async () => {
      sharePointSites.findFirstById.mockResolvedValue(null);

      await expect(service.checkReviewDateEligibility('org-1', 'site-missing', 'list-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns NoEligibleColumn — never throws — when no candidate exists', async () => {
      mockedListColumns.mockReturnValue(asyncGen([{ id: 'col-2', name: 'Title', displayName: 'Title' }]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      const result = await service.checkReviewDateEligibility('org-1', 'site-1', 'list-1');

      expect(result).toEqual({ status: 'NoEligibleColumn' });
      expect(sharePointReviewDateMappings.upsertActive).not.toHaveBeenCalled();
    });

    it('returns NoEligibleColumn when only system columns (Created/Modified) are present', async () => {
      const createdColumn = { id: 'sys-1', name: 'Created', displayName: 'Created', dateTime: {}, isDeletable: false };
      const modifiedColumn = { id: 'sys-2', name: 'Modified', displayName: 'Modified', dateTime: {}, isDeletable: false };
      mockedListColumns.mockReturnValue(asyncGen([createdColumn, modifiedColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      const result = await service.checkReviewDateEligibility('org-1', 'site-1', 'list-1');

      expect(result).toEqual({ status: 'NoEligibleColumn' });
    });

    it('returns SingleEligibleColumn with a high confidence score for a "Review Date" column', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      const result = await service.checkReviewDateEligibility('org-1', 'site-1', 'list-1');

      expect(result).toEqual({
        status: 'SingleEligibleColumn',
        column: { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' },
      });
    });

    it('returns MultipleEligibleColumns, each with its own confidence, without throwing', async () => {
      const expiryColumn = { id: 'col-2', name: 'ExpiryDate', displayName: 'Expiry Date', dateTime: {} };
      mockedListColumns.mockReturnValue(asyncGen([dateColumn, expiryColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      const result = await service.checkReviewDateEligibility('org-1', 'site-1', 'list-1');

      expect(result).toEqual({
        status: 'MultipleEligibleColumns',
        columns: [
          { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' },
          { id: 'col-2', name: 'ExpiryDate', displayName: 'Expiry Date', confidence: 'medium' },
        ],
      });
    });

    it('throws 503 when live Graph discovery fails — a genuine failure, distinct from a merely empty/ambiguous result', async () => {
      mockedListColumns.mockReturnValue(asyncGenThatThrows(new GraphThrottledError('Throttled')));

      await expect(service.checkReviewDateEligibility('org-1', 'site-1', 'list-1')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('Phase 1.2: never logs anything — a read-only inspection action, unchanged from Phase 1.1', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await service.checkReviewDateEligibility('org-1', 'site-1', 'list-1');

      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('Phase 1.2: still passes a correlationId to its Graph calls even though it never logs one', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await service.checkReviewDateEligibility('org-1', 'site-1', 'list-1');

      const options = mockedListColumns.mock.calls[0]?.[3] as { correlationId?: string } | undefined;
      expect(options?.correlationId).toBeDefined();
    });
  });

  describe('Phase 1.2 — confirm action structured logging', () => {
    it('logs a success event with organizationId, siteId, graphListId, resolved column, confirmedByUserId, and durationMs', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [message] = logSpy.mock.calls[0] as [string];
      expect(message).toContain('ReviewDateConfirm succeeded');
      expect(message).toContain('organizationId=org-1');
      expect(message).toContain('siteId=site-1');
      expect(message).toContain('graphListId=list-1');
      expect(message).toContain('columnDefinitionId=col-1');
      expect(message).toContain('columnDisplayName="Review Date"');
      expect(message).toContain('confirmedByUserId=user-1');
      expect(message).toMatch(/durationMs=\d+/);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('never logs document names or field values — only ids, counts, and status', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1');

      const [message] = logSpy.mock.calls[0] as [string];
      expect(message).not.toContain('nextReviewDueAt');
    });

    it('logs a failure event (not a success) when confirmation is rejected as ambiguous', async () => {
      mockedListColumns.mockReturnValue(
        asyncGen([dateColumn, { id: 'col-2', name: 'ExpiryDate', displayName: 'Expiry Date', dateTime: {} }]),
      );
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await expect(service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1')).rejects.toThrow(ConflictException);

      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message] = errorSpy.mock.calls[0] as [string];
      expect(message).toContain('ReviewDateConfirm failed');
      expect(message).toContain('organizationId=org-1');
      expect(message).toContain('confirmedByUserId=user-1');
      expect(message).toContain('errorType=ConflictException');
    });

    it('logs a failure event when live Graph discovery fails', async () => {
      mockedListColumns.mockReturnValue(asyncGenThatThrows(new GraphThrottledError('Throttled')));

      await expect(service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1')).rejects.toThrow(
        ServiceUnavailableException,
      );

      const [message] = errorSpy.mock.calls[0] as [string];
      expect(message).toContain('errorType=ServiceUnavailableException');
    });

    it('passes the same correlationId to every Graph call made during one confirm attempt', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));

      await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1');

      const columnsOptions = mockedListColumns.mock.calls[0]?.[3] as { correlationId?: string } | undefined;
      const contentTypesOptions = mockedListContentTypes.mock.calls[0]?.[3] as { correlationId?: string } | undefined;
      const [message] = logSpy.mock.calls[0] as [string];

      expect(columnsOptions?.correlationId).toBeDefined();
      expect(columnsOptions?.correlationId).toBe(contentTypesOptions?.correlationId);
      expect(message).toContain(`correlationId=${columnsOptions?.correlationId}`);
    });
  });

  describe('Phase 2 — confirmedByDisplayName resolution', () => {
    it('resolves the confirming user"s display name onto the response', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      users.findFirstById.mockResolvedValue({ id: 'user-1', displayName: 'Alice Admin' });

      const result = await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1');

      expect(result.confirmedByDisplayName).toBe('Alice Admin');
      expect(users.findFirstById).toHaveBeenCalledWith('user-1');
    });

    it('resolves to null when the confirming user no longer exists — never persisted, never throws', async () => {
      mockedListColumns.mockReturnValue(asyncGen([dateColumn]));
      mockedListContentTypes.mockReturnValue(asyncGen([]));
      users.findFirstById.mockResolvedValue(null);

      const result = await service.confirmReviewDateMapping('org-1', 'site-1', 'list-1', 'user-1');

      expect(result.confirmedByDisplayName).toBeNull();
    });
  });

  describe('listReviewDateLibraries', () => {
    it('throws 404 when the site does not exist in this organization', async () => {
      sharePointSites.findFirstById.mockResolvedValue(null);

      await expect(service.listReviewDateLibraries('org-1', 'site-missing')).rejects.toThrow(NotFoundException);
    });

    it('returns an empty array when the site has no document libraries', async () => {
      mockedListDrives.mockReturnValue(asyncGen([]));

      const result = await service.listReviewDateLibraries('org-1', 'site-1');

      expect(result).toEqual([]);
    });

    it('skips a drive with no associated list — not every drive is a document library', async () => {
      mockedListDrives.mockReturnValue(asyncGen([{ id: 'drive-1', name: 'OneDrive-ish', webUrl: 'https://x', driveType: 'business' }]));

      const result = await service.listReviewDateLibraries('org-1', 'site-1');

      expect(result).toEqual([]);
    });

    it('returns a library with mapping: null when no SharePointReviewDateMapping row exists for it', async () => {
      mockedListDrives.mockReturnValue(
        asyncGen([{ id: 'drive-1', name: 'Documents', webUrl: 'https://x', driveType: 'documentLibrary', list: { id: 'list-1' } }]),
      );
      sharePointReviewDateMappings.findManyBySite.mockResolvedValue([]);

      const result = await service.listReviewDateLibraries('org-1', 'site-1');

      expect(result).toEqual([{ graphListId: 'list-1', driveId: 'drive-1', name: 'Documents', mapping: null }]);
    });

    it('attaches the matching mapping (with resolved confirmedByDisplayName) when one exists for a library', async () => {
      mockedListDrives.mockReturnValue(
        asyncGen([{ id: 'drive-1', name: 'HR Docs', webUrl: 'https://x', driveType: 'documentLibrary', list: { id: 'list-1' } }]),
      );
      sharePointReviewDateMappings.findManyBySite.mockResolvedValue([
        {
          id: 'mapping-1',
          siteId: 'site-1',
          graphListId: 'list-1',
          columnDefinitionId: 'col-1',
          columnDisplayNameAtConfirmation: 'Review Date',
          status: 'Active',
          confirmedByUserId: 'user-1',
          confirmedAt: new Date('2026-08-10'),
        },
      ]);
      users.findFirstById.mockResolvedValue({ id: 'user-1', displayName: 'Alice Admin' });

      const result = await service.listReviewDateLibraries('org-1', 'site-1');

      expect(result).toHaveLength(1);
      expect(result[0]?.mapping).toEqual(
        expect.objectContaining({ status: 'Active', columnDisplayName: 'Review Date', confirmedByDisplayName: 'Alice Admin' }),
      );
    });

    it('does not attach a mapping belonging to a different library on the same site', async () => {
      mockedListDrives.mockReturnValue(
        asyncGen([{ id: 'drive-1', name: 'HR Docs', webUrl: 'https://x', driveType: 'documentLibrary', list: { id: 'list-1' } }]),
      );
      sharePointReviewDateMappings.findManyBySite.mockResolvedValue([
        {
          id: 'mapping-other',
          siteId: 'site-1',
          graphListId: 'list-OTHER',
          columnDefinitionId: 'col-1',
          columnDisplayNameAtConfirmation: 'Review Date',
          status: 'Active',
          confirmedByUserId: 'user-1',
          confirmedAt: new Date('2026-08-10'),
        },
      ]);

      const result = await service.listReviewDateLibraries('org-1', 'site-1');

      expect(result[0]?.mapping).toBeNull();
    });

    it('throws 503 when listDrives fails', async () => {
      mockedListDrives.mockReturnValue(asyncGenThatThrows(new GraphThrottledError('Throttled')));

      await expect(service.listReviewDateLibraries('org-1', 'site-1')).rejects.toThrow(ServiceUnavailableException);
    });

    it('never logs — a read-only inspection action, same as eligibility', async () => {
      mockedListDrives.mockReturnValue(asyncGen([]));

      await service.listReviewDateLibraries('org-1', 'site-1');

      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('ADR-0025 — Taxonomy classification fields', () => {
    const deptColumn = { id: 'col-dept', name: 'Department', displayName: 'Department' };
    const funcColumn = { id: 'col-func', name: 'Function', displayName: 'Function' };
    const hiddenColumn = { id: 'col-hidden', name: '_Hidden', displayName: 'Hidden', hidden: true };

    describe('listClassificationCandidates', () => {
      it('returns all non-hidden columns (merged from list + content types), deduped by id', async () => {
        mockedListColumns.mockReturnValue(asyncGen([deptColumn, hiddenColumn]));
        mockedListContentTypes.mockReturnValue(asyncGen([{ id: 'ct-1', name: 'Doc', columns: [funcColumn, deptColumn] }]));

        const result = await service.listClassificationCandidates('org-1', 'site-1', 'list-1');

        expect(result).toEqual([
          { id: 'col-dept', name: 'Department', displayName: 'Department' },
          { id: 'col-func', name: 'Function', displayName: 'Function' },
        ]);
      });

      it('throws 503 when Graph column metadata cannot be read', async () => {
        mockedListColumns.mockReturnValue(asyncGenThatThrows(new GraphThrottledError('Throttled')));
        mockedListContentTypes.mockReturnValue(asyncGen([]));

        await expect(service.listClassificationCandidates('org-1', 'site-1', 'list-1')).rejects.toThrow(
          ServiceUnavailableException,
        );
      });
    });

    describe('designateClassificationField', () => {
      beforeEach(() => {
        // mockImplementation (not mockReturnValue): an async generator is
        // consumed once, so a two-call test needs a fresh generator per call.
        mockedListColumns.mockImplementation(() => asyncGen([deptColumn, funcColumn]));
        mockedListContentTypes.mockImplementation(() => asyncGen([]));
        sharePointClassificationFields.upsertActive.mockResolvedValue({
          id: 'field-1',
          siteId: 'site-1',
          graphListId: 'list-1',
          columnDefinitionId: 'col-dept',
          columnDisplayNameAtConfirmation: 'Department',
          status: 'Active',
          staleDetectedAt: null,
          confirmedByUserId: 'user-1',
          confirmedAt: new Date('2026-09-08'),
        });
      });

      it('validates the column against live columns and upserts with the live display name', async () => {
        const result = await service.designateClassificationField('org-1', 'site-1', 'list-1', 'col-dept', 'user-1');

        expect(sharePointClassificationFields.upsertActive).toHaveBeenCalledWith({
          siteId: 'site-1',
          graphListId: 'list-1',
          columnDefinitionId: 'col-dept',
          columnDisplayNameAtConfirmation: 'Department',
          confirmedByUserId: 'user-1',
        });
        expect(result).toMatchObject({ id: 'field-1', columnDefinitionId: 'col-dept', status: 'Active', confirmedByDisplayName: 'Alice Admin' });
      });

      it('throws 400 and never upserts when the column is not a valid column for the library', async () => {
        await expect(service.designateClassificationField('org-1', 'site-1', 'list-1', 'col-missing', 'user-1')).rejects.toThrow(
          BadRequestException,
        );
        expect(sharePointClassificationFields.upsertActive).not.toHaveBeenCalled();
      });

      it('re-designating the same column is idempotent via upsert (no duplicate), returning the single row', async () => {
        await service.designateClassificationField('org-1', 'site-1', 'list-1', 'col-dept', 'user-1');
        await service.designateClassificationField('org-1', 'site-1', 'list-1', 'col-dept', 'user-1');
        // Both calls route through upsertActive on the same (site, list, column) key.
        expect(sharePointClassificationFields.upsertActive).toHaveBeenCalledTimes(2);
        expect(sharePointClassificationFields.upsertActive).toHaveBeenLastCalledWith(
          expect.objectContaining({ columnDefinitionId: 'col-dept' }),
        );
      });
    });

    describe('removeClassificationField', () => {
      it('deletes a field that belongs to the site', async () => {
        sharePointClassificationFields.findManyBySite.mockResolvedValue([{ id: 'field-1', siteId: 'site-1' }]);
        sharePointClassificationFields.deleteById.mockResolvedValue(true);

        await service.removeClassificationField('org-1', 'site-1', 'field-1');

        expect(sharePointClassificationFields.deleteById).toHaveBeenCalledWith('field-1');
      });

      it('throws 404 and never deletes when the field does not belong to the site (isolation)', async () => {
        sharePointClassificationFields.findManyBySite.mockResolvedValue([{ id: 'other-field', siteId: 'site-1' }]);

        await expect(service.removeClassificationField('org-1', 'site-1', 'field-1')).rejects.toThrow(NotFoundException);
        expect(sharePointClassificationFields.deleteById).not.toHaveBeenCalled();
      });
    });

    describe('listClassificationLibraries', () => {
      it('returns each library with its designated fields, including stale state', async () => {
        mockedListDrives.mockReturnValue(asyncGen([{ id: 'drive-1', name: 'Documents', list: { id: 'list-1' } }] as never));
        sharePointClassificationFields.findManyBySite.mockResolvedValue([
          {
            id: 'field-1',
            siteId: 'site-1',
            graphListId: 'list-1',
            columnDefinitionId: 'col-dept',
            columnDisplayNameAtConfirmation: 'Department',
            status: 'Stale',
            staleDetectedAt: new Date('2026-09-01'),
            confirmedByUserId: 'user-1',
            confirmedAt: new Date('2026-08-01'),
          },
        ]);

        const result = await service.listClassificationLibraries('org-1', 'site-1');

        expect(result).toEqual([
          {
            graphListId: 'list-1',
            driveId: 'drive-1',
            name: 'Documents',
            fields: [
              expect.objectContaining({
                id: 'field-1',
                columnDisplayName: 'Department',
                status: 'Stale',
                staleDetectedAt: '2026-09-01T00:00:00.000Z',
                confirmedByDisplayName: 'Alice Admin',
              }),
            ],
          },
        ]);
      });
    });
  });
});
