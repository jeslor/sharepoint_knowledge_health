import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import type { DocumentsService } from './documents.service';

describe('DocumentsController', () => {
  const service = {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    getDocumentHistory: jest.fn(),
    listOwners: jest.fn(),
    assignOwner: jest.fn(),
    removeOwner: jest.fn(),
    setReviewDate: jest.fn(),
    listDocumentHealth: jest.fn(),
  };
  const controller = new DocumentsController(service as unknown as DocumentsService);

  beforeEach(() => jest.clearAllMocks());

  it('listDocuments delegates organizationId from the route', async () => {
    service.listDocuments.mockResolvedValue([]);

    await controller.listDocuments('org-1');

    expect(service.listDocuments).toHaveBeenCalledWith('org-1');
  });

  describe('getDocument', () => {
    it('delegates organizationId and documentId from the route', async () => {
      service.getDocument.mockResolvedValue({ documentId: 'doc-1' });

      await controller.getDocument('org-1', 'doc-1');

      expect(service.getDocument).toHaveBeenCalledWith('org-1', 'doc-1');
    });

    it('throws 404 when the service resolves null (not found in this organization)', async () => {
      service.getDocument.mockResolvedValue(null);

      await expect(controller.getDocument('org-1', 'doc-from-another-org')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDocumentHistory', () => {
    it('delegates organizationId and documentId from the route', async () => {
      service.getDocumentHistory.mockResolvedValue({ documentId: 'doc-1', points: [] });

      await controller.getDocumentHistory('org-1', 'doc-1');

      expect(service.getDocumentHistory).toHaveBeenCalledWith('org-1', 'doc-1');
    });

    it('throws 404 when the service resolves null (not found in this organization)', async () => {
      service.getDocumentHistory.mockResolvedValue(null);

      await expect(controller.getDocumentHistory('org-1', 'doc-from-another-org')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listOwners', () => {
    it('delegates organizationId and documentId from the route', async () => {
      service.listOwners.mockResolvedValue([]);
      await controller.listOwners('org-1', 'doc-1');
      expect(service.listOwners).toHaveBeenCalledWith('org-1', 'doc-1');
    });

    it('throws 404 when the service resolves null', async () => {
      service.listOwners.mockResolvedValue(null);
      await expect(controller.listOwners('org-1', 'doc-from-another-org')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assignOwner', () => {
    it('rejects a body with neither displayName nor email with 400', async () => {
      await expect(
        controller.assignOwner('org-1', 'doc-1', { id: 'admin-1' } as never, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('delegates organizationId, documentId, the current user id, and the request body', async () => {
      service.assignOwner.mockResolvedValue({ id: 'owner-1' });

      await controller.assignOwner('org-1', 'doc-1', { id: 'admin-1' } as never, { displayName: 'Sarah' });

      expect(service.assignOwner).toHaveBeenCalledWith('org-1', 'doc-1', 'admin-1', { displayName: 'Sarah' });
    });

    it('throws 404 when the service resolves null (document not found)', async () => {
      service.assignOwner.mockResolvedValue(null);

      await expect(
        controller.assignOwner('org-1', 'doc-missing', { id: 'admin-1' } as never, { displayName: 'Sarah' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeOwner', () => {
    it('delegates organizationId, documentId, ownerId, and the current user id', async () => {
      await controller.removeOwner('org-1', 'doc-1', 'owner-1', { id: 'admin-1' } as never);
      expect(service.removeOwner).toHaveBeenCalledWith('org-1', 'doc-1', 'owner-1', 'admin-1');
    });
  });

  describe('setReviewDate', () => {
    it('delegates organizationId, documentId, and the parsed date', async () => {
      service.setReviewDate.mockResolvedValue({ documentId: 'doc-1', nextReviewDueAt: '2026-12-01T00:00:00.000Z', reviewDateSource: 'Manual' });

      await controller.setReviewDate('org-1', 'doc-1', { nextReviewDueAt: '2026-12-01T00:00:00.000Z' });

      expect(service.setReviewDate).toHaveBeenCalledWith('org-1', 'doc-1', '2026-12-01T00:00:00.000Z');
    });

    it('delegates null to clear a previously-set review date', async () => {
      service.setReviewDate.mockResolvedValue({ documentId: 'doc-1', nextReviewDueAt: null, reviewDateSource: 'Manual' });

      await controller.setReviewDate('org-1', 'doc-1', { nextReviewDueAt: null });

      expect(service.setReviewDate).toHaveBeenCalledWith('org-1', 'doc-1', null);
    });

    it('rejects an invalid date string with 400', async () => {
      await expect(
        controller.setReviewDate('org-1', 'doc-1', { nextReviewDueAt: 'not-a-date' }),
      ).rejects.toThrow(BadRequestException);
      expect(service.setReviewDate).not.toHaveBeenCalled();
    });

    it('throws 404 when the service resolves null (document not found)', async () => {
      service.setReviewDate.mockResolvedValue(null);

      await expect(
        controller.setReviewDate('org-1', 'doc-missing', { nextReviewDueAt: null }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listDocumentHealth', () => {
    it('delegates organizationId with default-parsed query when no params are supplied', async () => {
      service.listDocumentHealth.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });

      await controller.listDocumentHealth('org-1', {});

      expect(service.listDocumentHealth).toHaveBeenCalledWith('org-1', {
        page: undefined,
        pageSize: undefined,
        sortBy: undefined,
        sortDir: undefined,
        severity: undefined,
        siteId: undefined,
        minScore: undefined,
        maxScore: undefined,
      });
    });

    it('parses and passes through valid query params', async () => {
      service.listDocumentHealth.mockResolvedValue({ data: [], pagination: { page: 2, pageSize: 10, total: 0, totalPages: 1 } });

      await controller.listDocumentHealth('org-1', {
        page: '2',
        pageSize: '10',
        sortBy: 'name',
        sortDir: 'desc',
        severity: 'RequiresReview',
        siteId: 'site-1',
        minScore: '10',
        maxScore: '90',
      });

      expect(service.listDocumentHealth).toHaveBeenCalledWith('org-1', {
        page: 2,
        pageSize: 10,
        sortBy: 'name',
        sortDir: 'desc',
        severity: 'RequiresReview',
        siteId: 'site-1',
        minScore: 10,
        maxScore: 90,
      });
    });

    it.each([
      ['page', { page: '0' }],
      ['page', { page: 'abc' }],
      ['pageSize', { pageSize: '101' }],
      ['sortBy', { sortBy: 'bogus' }],
      ['sortDir', { sortDir: 'bogus' }],
      ['severity', { severity: 'HIGH' }],
      ['minScore', { minScore: '-1' }],
      ['maxScore', { maxScore: '101' }],
    ])('rejects an invalid %s value with 400', async (_label, badQuery) => {
      await expect(controller.listDocumentHealth('org-1', badQuery)).rejects.toThrow(BadRequestException);
    });

    it('rejects minScore greater than maxScore with 400', async () => {
      await expect(
        controller.listDocumentHealth('org-1', { minScore: '80', maxScore: '20' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
