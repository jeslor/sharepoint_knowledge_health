import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import type { DocumentsService } from './documents.service';

describe('DocumentsController', () => {
  const service = {
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
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
