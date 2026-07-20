import { NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import { OnboardingStatusService } from './onboarding-status.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

function tenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant-1',
    status: 'Consented',
    discoveryStatus: 'NotStarted',
    discoveryStartedAt: null,
    discoveryCompletedAt: null,
    discoveryError: null,
    ...overrides,
  };
}

describe('OnboardingStatusService (ADR-0017, Phase 1b — discovery slice only)', () => {
  const service = new OnboardingStatusService();
  const microsoftTenants = { findMany: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ microsoftTenants } as never);
  });

  it('throws NotFoundException when the organization has no Microsoft tenant', async () => {
    microsoftTenants.findMany.mockResolvedValue([]);

    await expect(service.getStatus('org-1')).rejects.toThrow(NotFoundException);
  });

  it.each(['PendingConsent', 'Consented', 'Revoked'] as const)(
    'reports microsoftTenantStatus %s exactly as stored',
    async (status) => {
      microsoftTenants.findMany.mockResolvedValue([tenant({ status })]);

      const result = await service.getStatus('org-1');

      expect(result.microsoftTenantStatus).toBe(status);
    },
  );

  it.each(['NotStarted', 'Queued', 'Running', 'Completed', 'Failed'] as const)(
    'reports discoveryStatus %s exactly as stored',
    async (discoveryStatus) => {
      microsoftTenants.findMany.mockResolvedValue([tenant({ discoveryStatus })]);

      const result = await service.getStatus('org-1');

      expect(result.discoveryStatus).toBe(discoveryStatus);
    },
  );

  it('converts discoveryStartedAt/discoveryCompletedAt to ISO strings, and null stays null', async () => {
    microsoftTenants.findMany.mockResolvedValue([
      tenant({
        discoveryStartedAt: new Date('2026-07-20T12:00:00.000Z'),
        discoveryCompletedAt: null,
      }),
    ]);

    const result = await service.getStatus('org-1');

    expect(result.discoveryStartedAt).toBe('2026-07-20T12:00:00.000Z');
    expect(result.discoveryCompletedAt).toBeNull();
  });

  it('passes discoveryError through verbatim, including null', async () => {
    microsoftTenants.findMany.mockResolvedValue([tenant({ discoveryError: 'Graph unavailable' })]);

    const result = await service.getStatus('org-1');

    expect(result.discoveryError).toBe('Graph unavailable');
  });

  it('reports on the first-connected Microsoft tenant when more than one exists', async () => {
    microsoftTenants.findMany.mockResolvedValue([tenant({ id: 'tenant-1', discoveryStatus: 'Completed' })]);

    await service.getStatus('org-1');

    expect(microsoftTenants.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' }, take: 1 }),
    );
  });
});
