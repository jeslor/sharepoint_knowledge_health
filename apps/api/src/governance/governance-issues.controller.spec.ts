import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { User } from '@sph/database';
import { GovernanceIssuesController } from './governance-issues.controller';
import type { GovernanceActivityService } from './governance-activity.service';
import type { GovernanceAnalyticsService } from './governance-analytics.service';
import type { GovernanceIssuesService } from './governance-issues.service';

const actor = { id: 'actor-1', role: 'Admin' } as User;

describe('GovernanceIssuesController', () => {
  const service = {
    listIssues: jest.fn(),
    getIssue: jest.fn(),
    createIssue: jest.fn(),
    updateIssue: jest.fn(),
    getSummary: jest.fn(),
    listAssignableUsers: jest.fn(),
  };
  const activityService = {
    listIssueActivity: jest.fn(),
    listOrganizationActivity: jest.fn(),
  };
  const analyticsService = {
    getAnalytics: jest.fn(),
  };
  const controller = new GovernanceIssuesController(
    service as unknown as GovernanceIssuesService,
    activityService as unknown as GovernanceActivityService,
    analyticsService as unknown as GovernanceAnalyticsService,
  );

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
      await expect(
        controller.createIssue('org-1', actor, { documentId: '', issueType: 'Freshness' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid issueType with 400', async () => {
      await expect(
        controller.createIssue('org-1', actor, { documentId: 'doc-1', issueType: 'Bogus' as never }),
      ).rejects.toThrow(BadRequestException);
    });

    it('delegates a valid request to the service with the current user id', async () => {
      service.createIssue.mockResolvedValue({ id: 'issue-1' });
      await controller.createIssue('org-1', actor, { documentId: 'doc-1', issueType: 'Freshness' });
      expect(service.createIssue).toHaveBeenCalledWith('org-1', 'actor-1', { documentId: 'doc-1', issueType: 'Freshness' });
    });
  });

  describe('updateIssue', () => {
    it('rejects an empty body with 400', async () => {
      await expect(controller.updateIssue('org-1', 'issue-1', actor, {})).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid status value with 400', async () => {
      await expect(
        controller.updateIssue('org-1', 'issue-1', actor, { status: 'Bogus' as never }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 when the service resolves null', async () => {
      service.updateIssue.mockResolvedValue(null);
      await expect(
        controller.updateIssue('org-1', 'issue-missing', actor, { status: 'InProgress' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('delegates a valid update to the service with the current user id', async () => {
      service.updateIssue.mockResolvedValue({ id: 'issue-1', status: 'InProgress' });
      await controller.updateIssue('org-1', 'issue-1', actor, { status: 'InProgress' });
      expect(service.updateIssue).toHaveBeenCalledWith('org-1', 'issue-1', 'actor-1', 'Admin', { status: 'InProgress' });
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

  describe('listIssueActivity', () => {
    it('delegates organizationId, issueId, and default-parsed query', async () => {
      activityService.listIssueActivity.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });

      await controller.listIssueActivity('org-1', 'issue-1', {});

      expect(activityService.listIssueActivity).toHaveBeenCalledWith('org-1', 'issue-1', {
        page: undefined,
        pageSize: undefined,
        activityType: undefined,
        sortDir: undefined,
        since: undefined,
        until: undefined,
      });
    });

    it.each([
      ['page', { page: '0' }],
      ['pageSize', { pageSize: '101' }],
      ['activityType', { activityType: 'Bogus' }],
      ['sortDir', { sortDir: 'bogus' }],
      ['since', { since: 'not-a-date' }],
      ['until', { until: 'not-a-date' }],
    ])('rejects an invalid %s value with 400', async (_label, badQuery) => {
      await expect(controller.listIssueActivity('org-1', 'issue-1', badQuery)).rejects.toThrow(BadRequestException);
    });
  });

  describe('listOrganizationActivity', () => {
    it('delegates organizationId and default-parsed query', async () => {
      activityService.listOrganizationActivity.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });

      await controller.listOrganizationActivity('org-1', { activityType: 'IssueCreated' });

      expect(activityService.listOrganizationActivity).toHaveBeenCalledWith('org-1', {
        page: undefined,
        pageSize: undefined,
        activityType: 'IssueCreated',
        sortDir: undefined,
        since: undefined,
        until: undefined,
      });
    });
  });

  describe('getAnalytics', () => {
    it('delegates organizationId with default-parsed query when no params are supplied', async () => {
      analyticsService.getAnalytics.mockResolvedValue({});

      await controller.getAnalytics('org-1', {});

      expect(analyticsService.getAnalytics).toHaveBeenCalledWith('org-1', {
        since: undefined,
        until: undefined,
        status: undefined,
        severity: undefined,
        issueType: undefined,
        assignedUserId: undefined,
      });
    });

    it('parses valid query params through', async () => {
      analyticsService.getAnalytics.mockResolvedValue({});

      await controller.getAnalytics('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-07-01T00:00:00.000Z',
        status: 'Open',
        severity: 'RequiresReview',
        issueType: 'Freshness',
        assignedUserId: 'user-1',
      });

      expect(analyticsService.getAnalytics).toHaveBeenCalledWith('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-07-01T00:00:00.000Z',
        status: 'Open',
        severity: 'RequiresReview',
        issueType: 'Freshness',
        assignedUserId: 'user-1',
      });
    });

    it.each([
      ['since', { since: 'not-a-date' }],
      ['until', { until: 'not-a-date' }],
      ['status', { status: 'Bogus' }],
      ['severity', { severity: 'HIGH' }],
      ['issueType', { issueType: 'Bogus' }],
    ])('rejects an invalid %s value with 400', async (_label, badQuery) => {
      await expect(controller.getAnalytics('org-1', badQuery)).rejects.toThrow(BadRequestException);
    });
  });
});
