import { UpgradeRequestController } from './upgrade-request.controller';
import type { UpgradeRequestService } from './upgrade-request.service';

describe('UpgradeRequestController (Phase 6)', () => {
  const service = { requestUpgrade: jest.fn() };
  const controller = new UpgradeRequestController(service as unknown as UpgradeRequestService);

  beforeEach(() => jest.clearAllMocks());

  it('delegates organizationId, the current user, and the optional message', async () => {
    service.requestUpgrade.mockResolvedValue({ id: 'req-1', status: 'Pending', createdAt: '2026-09-22T12:30:00.000Z' });
    const user = { id: 'user-1', displayName: 'Jane Doe' };

    await controller.requestUpgrade('org-1', user as never, { message: 'We need more capacity.' });

    expect(service.requestUpgrade).toHaveBeenCalledWith('org-1', user, 'We need more capacity.');
  });

  it('passes an undefined message when no body is sent', async () => {
    service.requestUpgrade.mockResolvedValue({ id: 'req-1', status: 'Pending', createdAt: '2026-09-22T12:30:00.000Z' });
    const user = { id: 'user-1', displayName: 'Jane Doe' };

    await controller.requestUpgrade('org-1', user as never, undefined);

    expect(service.requestUpgrade).toHaveBeenCalledWith('org-1', user, undefined);
  });
});

// Authorization is provided entirely by existing, unmodified guards
// (EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard) applied via
// decorators exactly like every other organization-scoped route — never a
// weaker/custom authorization path. OrganizationAccessGuard's own spec
// covers the cross-tenant-rejection behavior generically; not re-tested
// here, matching every other controller in this codebase.
