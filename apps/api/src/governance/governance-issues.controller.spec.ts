import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GovernanceIssuesController } from './governance-issues.controller';
import type { GovernanceIssuesService } from './governance-issues.service';

describe('GovernanceIssuesController', () => {
  const service = {
    listIssues: jest.fn(),
    getIssue: jest.fn(),
    createIssue: jest.fn(),
    updateIssue: jest.fn(),
    getSummary: jest.fn(),
    listAssignableUsers: jest.fn(),
  };
  const controller = new GovernanceIssuesController(service as unknown as GovernanceIssuesService);

  beforeEach(() => jest.clearAllMocks());

  describe('listIssues', () => {
    it('delegates organizationId with default-parsed query when no params are supplied', async () => {
      service.listIssues.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });

      await controller.listIssues('org-1', {});

      expect(service.listIssues).toHaveBeenCalledWith('org-1', {
        page: undefined,
        pageSize: undefined,
        status: undefined,
        severity: undefined,
        assignedUserId: undefined,
        issueType: undefined,
        documentId: undefined,
        sortBy: undefined,
        sortDir: undefined,
      });
    });

    it('parses valid query params through', async () => {
      service.listIssues.mockResolvedValue({ data: [], pagination: { page: 2, pageSize: 10, total: 0, totalPages: 1 } });

      await controller.listIssues('org-1', {
        page: '2',
        pageSize: '10',
        status: 'Open',
        severity: 'RequiresReview',
        assignedUserId: 'user-1',
        issueType: 'Freshness',
        documentId: 'doc-1',
        sortBy: 'updatedAt',
        sortDir: 'asc',
      });

      expect(service.listIssues).toHaveBeenCalledWith('org-1', {
        page: 2,
        pageSize: 10,
        status: 'Open',
        severity: 'RequiresReview',
        assignedUserId: 'user-1',
        issueType: 'Freshness',
        documentId: 'doc-1',
        sortBy: 'updatedAt',
        sortDir: 'asc',
      });
    });

    it.each([
      ['page', { page: '0' }],
      ['pageSize', { pageSize: '101' }],
      ['status', { status: 'Bogus' }],
      ['severity', { severity: 'HIGH' }],
      ['issueType', { issueType: 'Bogus' }],
      ['sortBy', { sortBy: 'bogus' }],
      ['sortDir', { sortDir: 'bogus' }],
    ])('rejects an invalid %s value with 400', async (_label, badQuery) => {
      await expect(controller.listIssues('org-1', badQuery)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getIssue', () => {
    it('delegates organizationId and issueId', async () => {
      service.getIssue.mockResolvedValue({ id: 'issue-1' });
      await controller.getIssue('org-1', 'issue-1');
      expect(service.getIssue).toHaveBeenCalledWith('org-1', 'issue-1');
    });

    it('throws 404 when the service resolves null', async () => {
      service.getIssue.mockResolvedValue(null);
      await expect(controller.getIssue('org-1', 'issue-missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createIssue', () => {
    it('rejects a missing documentId with 400', async () => {
      await expect(controller.createIssue('org-1', { documentId: '', issueType: 'Freshness' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an invalid issueType with 400', async () => {
      await expect(
        controller.createIssue('org-1', { documentId: 'doc-1', issueType: 'Bogus' as never }),
      ).rejects.toThrow(BadRequestException);
    });

    it('delegates a valid request to the service', async () => {
      service.createIssue.mockResolvedValue({ id: 'issue-1' });
      await controller.createIssue('org-1', { documentId: 'doc-1', issueType: 'Freshness' });
      expect(service.createIssue).toHaveBeenCalledWith('org-1', { documentId: 'doc-1', issueType: 'Freshness' });
    });
  });

  describe('updateIssue', () => {
    it('rejects an empty body with 400', async () => {
      await expect(controller.updateIssue('org-1', 'issue-1', {})).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid status value with 400', async () => {
      await expect(controller.updateIssue('org-1', 'issue-1', { status: 'Bogus' as never })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 404 when the service resolves null', async () => {
      service.updateIssue.mockResolvedValue(null);
      await expect(controller.updateIssue('org-1', 'issue-missing', { status: 'InProgress' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('delegates a valid update to the service', async () => {
      service.updateIssue.mockResolvedValue({ id: 'issue-1', status: 'InProgress' });
      await controller.updateIssue('org-1', 'issue-1', { status: 'InProgress' });
      expect(service.updateIssue).toHaveBeenCalledWith('org-1', 'issue-1', { status: 'InProgress' });
    });
  });

  describe('getSummary', () => {
    it('delegates organizationId from the route', async () => {
      service.getSummary.mockResolvedValue({});
      await controller.getSummary('org-1');
      expect(service.getSummary).toHaveBeenCalledWith('org-1');
    });
  });

  describe('listAssignableUsers', () => {
    it('delegates organizationId from the route', async () => {
      service.listAssignableUsers.mockResolvedValue([]);
      await controller.listAssignableUsers('org-1');
      expect(service.listAssignableUsers).toHaveBeenCalledWith('org-1');
    });
  });
});
