import { HealthSummaryController } from './health-summary.controller';
import type { HealthSummaryService } from './health-summary.service';

describe('HealthSummaryController', () => {
  const service = { getSummary: jest.fn() };
  const controller = new HealthSummaryController(service as unknown as HealthSummaryService);

  beforeEach(() => jest.clearAllMocks());

  it('delegates organizationId from the route', async () => {
    service.getSummary.mockResolvedValue({});

    await controller.getSummary('org-1');

    expect(service.getSummary).toHaveBeenCalledWith('org-1');
  });
});
