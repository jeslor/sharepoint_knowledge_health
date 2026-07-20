import { OnboardingStatusController } from './onboarding-status.controller';
import type { OnboardingStatusService } from './onboarding-status.service';

describe('OnboardingStatusController', () => {
  const service = { getStatus: jest.fn() };
  const controller = new OnboardingStatusController(service as unknown as OnboardingStatusService);

  beforeEach(() => jest.clearAllMocks());

  it('delegates organizationId from the route', async () => {
    const response = {
      microsoftTenantStatus: 'Consented',
      discoveryStatus: 'Completed',
      discoveryStartedAt: null,
      discoveryCompletedAt: null,
      discoveryError: null,
    };
    service.getStatus.mockResolvedValue(response);

    const result = await controller.getStatus('org-1');

    expect(service.getStatus).toHaveBeenCalledWith('org-1');
    expect(result).toBe(response);
  });
});
