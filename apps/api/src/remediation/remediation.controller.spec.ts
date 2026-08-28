import { BadRequestException } from '@nestjs/common';
import { RemediationController } from './remediation.controller';
import type { RemediationService } from './remediation.service';

describe('RemediationController', () => {
  const service = {
    createRemediationJob: jest.fn(),
    listRemediationJobs: jest.fn(),
    getRemediationJob: jest.fn(),
  };
  const controller = new RemediationController(service as unknown as RemediationService);

  beforeEach(() => jest.clearAllMocks());

  it('createRemediationJob delegates organizationId, the current user id/role, and the request body', async () => {
    service.createRemediationJob.mockResolvedValue({ remediationJobId: 'job-1', totalCount: 2, ineligibleDocumentIds: [] });

    const body = {
      issueType: 'ReviewStatus' as const,
      documentIds: ['doc-1', 'doc-2'],
      nextReviewDueAt: '2026-12-01T00:00:00.000Z',
    };
    const result = await controller.createRemediationJob('org-1', { id: 'user-1', role: 'Admin' } as never, body);

    expect(service.createRemediationJob).toHaveBeenCalledWith('org-1', 'user-1', 'Admin', body);
    expect(result).toEqual({ remediationJobId: 'job-1', totalCount: 2, ineligibleDocumentIds: [] });
  });

  describe('listRemediationJobs (P0-3)', () => {
    it('delegates organizationId and parsed page/pageSize to the service', async () => {
      service.listRemediationJobs.mockResolvedValue({ data: [], pagination: { page: 2, pageSize: 10, total: 0, totalPages: 1 } });

      const result = await controller.listRemediationJobs('org-1', { page: '2', pageSize: '10' });

      expect(service.listRemediationJobs).toHaveBeenCalledWith('org-1', { page: 2, pageSize: 10 });
      expect(result).toEqual({ data: [], pagination: { page: 2, pageSize: 10, total: 0, totalPages: 1 } });
    });

    it('passes page/pageSize through as undefined when the query is empty, letting the service apply its own defaults', async () => {
      service.listRemediationJobs.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });

      await controller.listRemediationJobs('org-1', {});

      expect(service.listRemediationJobs).toHaveBeenCalledWith('org-1', { page: undefined, pageSize: undefined });
    });

    it('rejects a non-positive-integer page', async () => {
      await expect(controller.listRemediationJobs('org-1', { page: '0' })).rejects.toThrow(BadRequestException);
      expect(service.listRemediationJobs).not.toHaveBeenCalled();
    });

    it('rejects a pageSize over 100', async () => {
      await expect(controller.listRemediationJobs('org-1', { pageSize: '101' })).rejects.toThrow(BadRequestException);
      expect(service.listRemediationJobs).not.toHaveBeenCalled();
    });
  });

  describe('getRemediationJob (P0-3)', () => {
    it('delegates organizationId and jobId to the service', async () => {
      const detail = { id: 'job-1', status: 'Completed', items: [] };
      service.getRemediationJob.mockResolvedValue(detail);

      const result = await controller.getRemediationJob('org-1', 'job-1');

      expect(service.getRemediationJob).toHaveBeenCalledWith('org-1', 'job-1');
      expect(result).toEqual(detail);
    });
  });
});

// Authorization for this controller is provided entirely by existing,
// unmodified guards, applied via decorators exactly like every other
// mutating endpoint in this codebase:
//  - @Roles('Admin', 'GovernanceManager') + RolesGuard — Admin-can /
//    GovernanceManager-can / Member-403 are proven directly against the
//    real RolesGuard class in ../auth/roles.guard.spec.ts, exercised with
//    this exact role set.
//  - OrganizationAccessGuard (class-level @UseGuards) — "organizationId
//    belonging to another organization receives 403" is already proven
//    directly against the real, unmodified OrganizationAccessGuard class
//    in ../common/organization-access.guard.spec.ts.
// Neither is re-tested here — doing so would duplicate coverage of classes
// this controller reuses verbatim, not anything new this controller adds.
