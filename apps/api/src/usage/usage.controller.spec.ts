import { UsageController } from './usage.controller';
import type { UsageService } from './usage.service';

describe('UsageController (Phase 4)', () => {
  const service = { getUsage: jest.fn() };
  const controller = new UsageController(service as unknown as UsageService);

  beforeEach(() => jest.clearAllMocks());

  it('delegates to UsageService.getUsage with the organization id from the route', async () => {
    const response = {
      planType: 'Trial',
      documentLimit: 2000,
      currentDocumentCount: 1847,
      remainingDocumentCount: 153,
      usagePercentage: 92.35,
      limitReached: false,
    };
    service.getUsage.mockResolvedValue(response);

    const result = await controller.getUsage('org-1');

    expect(service.getUsage).toHaveBeenCalledWith('org-1');
    expect(result).toEqual(response);
  });
});

// Authorization for this controller is provided entirely by existing,
// unmodified guards, applied via decorators exactly like every other
// read-tier endpoint in this codebase (HealthSummary/Ownership/AuditLog) —
// deliberately no RolesGuard/@Roles, since usage is a read, not a
// mutation. EntraJwtGuard/TenantContextGuard/OrganizationAccessGuard are
// already covered by their own dedicated spec files elsewhere (including
// OrganizationAccessGuard's own IDOR-prevention test), not re-tested here.
// The :id route param is NEVER trusted as authorization on its own — it is
// only ever used after OrganizationAccessGuard has already verified it
// matches request.user.organizationId (derived from the authenticated
// Entra identity, never from client input).
