import { BadRequestException } from '@nestjs/common';
import { SharePointMetadataController } from './sharepoint-metadata.controller';
import type { SharePointMetadataService } from './sharepoint-metadata.service';

describe('SharePointMetadataController', () => {
  const service = {
    confirmReviewDateMapping: jest.fn(),
    checkReviewDateEligibility: jest.fn(),
    listReviewDateLibraries: jest.fn(),
    listClassificationLibraries: jest.fn(),
    listClassificationCandidates: jest.fn(),
    designateClassificationField: jest.fn(),
    removeClassificationField: jest.fn(),
  };
  const controller = new SharePointMetadataController(service as unknown as SharePointMetadataService);

  beforeEach(() => jest.clearAllMocks());

  describe('confirmReviewDateMapping', () => {
    it('rejects a body with no graphListId with 400', async () => {
      await expect(
        controller.confirmReviewDateMapping('org-1', 'site-1', { id: 'admin-1' } as never, {} as never),
      ).rejects.toThrow(BadRequestException);
      expect(service.confirmReviewDateMapping).not.toHaveBeenCalled();
    });

    it('delegates organizationId, siteId, graphListId, and the current user id', async () => {
      service.confirmReviewDateMapping.mockResolvedValue({ id: 'mapping-1' });

      await controller.confirmReviewDateMapping('org-1', 'site-1', { id: 'admin-1' } as never, {
        graphListId: 'list-1',
      });

      expect(service.confirmReviewDateMapping).toHaveBeenCalledWith('org-1', 'site-1', 'list-1', 'admin-1', undefined);
    });

    it('delegates an explicit columnDefinitionId selection when provided (the multiple-candidates case)', async () => {
      service.confirmReviewDateMapping.mockResolvedValue({ id: 'mapping-1' });

      await controller.confirmReviewDateMapping('org-1', 'site-1', { id: 'admin-1' } as never, {
        graphListId: 'list-1',
        columnDefinitionId: 'col-2',
      });

      expect(service.confirmReviewDateMapping).toHaveBeenCalledWith('org-1', 'site-1', 'list-1', 'admin-1', 'col-2');
    });
  });

  describe('checkReviewDateEligibility', () => {
    it('rejects a missing graphListId query param with 400', async () => {
      await expect(controller.checkReviewDateEligibility('org-1', 'site-1', '')).rejects.toThrow(BadRequestException);
      expect(service.checkReviewDateEligibility).not.toHaveBeenCalled();
    });

    it('delegates organizationId, siteId, and graphListId', async () => {
      service.checkReviewDateEligibility.mockResolvedValue({ status: 'NoEligibleColumn' });

      await controller.checkReviewDateEligibility('org-1', 'site-1', 'list-1');

      expect(service.checkReviewDateEligibility).toHaveBeenCalledWith('org-1', 'site-1', 'list-1');
    });

    it('returns whatever the service resolves, unmodified', async () => {
      const response = { status: 'SingleEligibleColumn', column: { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' } };
      service.checkReviewDateEligibility.mockResolvedValue(response);

      const result = await controller.checkReviewDateEligibility('org-1', 'site-1', 'list-1');

      expect(result).toEqual(response);
    });
  });

  describe('listReviewDateLibraries', () => {
    it('delegates organizationId and siteId', async () => {
      service.listReviewDateLibraries.mockResolvedValue([]);

      await controller.listReviewDateLibraries('org-1', 'site-1');

      expect(service.listReviewDateLibraries).toHaveBeenCalledWith('org-1', 'site-1');
    });

    it('returns whatever the service resolves, unmodified', async () => {
      const response = [{ graphListId: 'list-1', driveId: 'drive-1', name: 'Documents', mapping: null }];
      service.listReviewDateLibraries.mockResolvedValue(response);

      const result = await controller.listReviewDateLibraries('org-1', 'site-1');

      expect(result).toEqual(response);
    });
  });

  describe('ADR-0025 — classification field endpoints', () => {
    it('listClassificationLibraries delegates organizationId and siteId', async () => {
      service.listClassificationLibraries.mockResolvedValue([]);
      await controller.listClassificationLibraries('org-1', 'site-1');
      expect(service.listClassificationLibraries).toHaveBeenCalledWith('org-1', 'site-1');
    });

    it('listClassificationCandidates rejects a missing graphListId with 400', async () => {
      await expect(controller.listClassificationCandidates('org-1', 'site-1', '')).rejects.toThrow(BadRequestException);
      expect(service.listClassificationCandidates).not.toHaveBeenCalled();
    });

    it('listClassificationCandidates delegates organizationId, siteId, graphListId', async () => {
      service.listClassificationCandidates.mockResolvedValue([]);
      await controller.listClassificationCandidates('org-1', 'site-1', 'list-1');
      expect(service.listClassificationCandidates).toHaveBeenCalledWith('org-1', 'site-1', 'list-1');
    });

    it('designateClassificationField rejects a body missing graphListId or columnDefinitionId with 400', async () => {
      await expect(
        controller.designateClassificationField('org-1', 'site-1', { id: 'admin-1' } as never, { graphListId: 'list-1' } as never),
      ).rejects.toThrow(BadRequestException);
      expect(service.designateClassificationField).not.toHaveBeenCalled();
    });

    it('designateClassificationField delegates org, site, graphListId, columnDefinitionId, and current user id', async () => {
      service.designateClassificationField.mockResolvedValue({ id: 'field-1' });
      await controller.designateClassificationField('org-1', 'site-1', { id: 'admin-1' } as never, {
        graphListId: 'list-1',
        columnDefinitionId: 'col-dept',
      });
      expect(service.designateClassificationField).toHaveBeenCalledWith('org-1', 'site-1', 'list-1', 'col-dept', 'admin-1');
    });

    it('removeClassificationField delegates org, site, and fieldId', async () => {
      service.removeClassificationField.mockResolvedValue(undefined);
      await controller.removeClassificationField('org-1', 'site-1', 'field-1');
      expect(service.removeClassificationField).toHaveBeenCalledWith('org-1', 'site-1', 'field-1');
    });
  });
});
