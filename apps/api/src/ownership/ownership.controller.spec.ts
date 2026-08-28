import { OwnershipController } from './ownership.controller';
import type { OwnershipCoverageService } from './ownership.service';

describe('OwnershipController (ADR-0024 Phase A)', () => {
  const service = { getCoverage: jest.fn() };
  const controller = new OwnershipController(service as unknown as OwnershipCoverageService);

  beforeEach(() => jest.clearAllMocks());

  it('delegates to OwnershipCoverageService.getCoverage with the organization id from the route', async () => {
    const response = {
      organizationWide: { covered: 1, noIdentifiableOwner: 0, allOwnersInactive: 0, notYetScored: 0, totalDocuments: 1, scoredDocuments: 1, coveragePercentage: 100 },
      bySite: [],
      ownerSourceBreakdown: { graphMetadataCount: 0, manualAssignmentCount: 0 },
      identityBreakdown: { activeRegisteredCount: 0, deactivatedRegisteredCount: 0, externalOrUnregisteredCount: 0 },
      calculatedAt: '2026-08-28T00:00:00.000Z',
    };
    service.getCoverage.mockResolvedValue(response);

    const result = await controller.getOwnershipCoverage('org-1');

    expect(service.getCoverage).toHaveBeenCalledWith('org-1');
    expect(result).toEqual(response);
  });
});

// Authorization for this controller is provided entirely by existing,
// unmodified guards, applied via decorators exactly like every other
// read-tier endpoint in this codebase (ADR-0024 §3.5) — deliberately no
// RolesGuard/@Roles, since ownership coverage is a read, not a mutation.
// EntraJwtGuard/TenantContextGuard/OrganizationAccessGuard are already
// covered by their own dedicated spec files elsewhere; not re-tested here.
