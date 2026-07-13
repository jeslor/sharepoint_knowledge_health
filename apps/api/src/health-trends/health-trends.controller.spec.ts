import { BadRequestException } from '@nestjs/common';
import { HealthTrendsController } from './health-trends.controller';
import type { HealthTrendsService } from './health-trends.service';

describe('HealthTrendsController', () => {
  const service = { getOrganizationTrend: jest.fn() };
  const controller = new HealthTrendsController(service as unknown as HealthTrendsService);

  beforeEach(() => jest.clearAllMocks());

  it('delegates organizationId with the default 30-day window when no query param is supplied', async () => {
    service.getOrganizationTrend.mockResolvedValue({ days: 30, points: [] });

    await controller.getOrganizationTrend('org-1');

    expect(service.getOrganizationTrend).toHaveBeenCalledWith('org-1', 30);
  });

  it('parses a valid days query param', async () => {
    service.getOrganizationTrend.mockResolvedValue({ days: 7, points: [] });

    await controller.getOrganizationTrend('org-1', '7');

    expect(service.getOrganizationTrend).toHaveBeenCalledWith('org-1', 7);
  });

  it.each([['0'], ['366'], ['abc'], ['1.5']])('rejects an invalid days value (%s) with 400', async (badDays) => {
    await expect(controller.getOrganizationTrend('org-1', badDays)).rejects.toThrow(BadRequestException);
  });
});
