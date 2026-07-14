import { createTenantContext, findDueScanSchedules } from '@sph/database';
import type { Queue } from 'bullmq';
import { SchedulerProcessor } from './scheduler.processor';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;
const mockedFindDueScanSchedules = findDueScanSchedules as jest.MockedFunction<typeof findDueScanSchedules>;

function schedule(overrides: Partial<{ id: string; organizationId: string; frequency: string; nextRunAt: Date }> = {}) {
  return {
    id: 'schedule-1',
    organizationId: 'org-1',
    frequency: 'Daily',
    enabled: true,
    nextRunAt: new Date('2026-07-13T02:00:00.000Z'),
    lastRunAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('SchedulerProcessor', () => {
  const scanQueue = { add: jest.fn() };
  const microsoftTenants = { findMany: jest.fn() };
  const scanJobs = { findMany: jest.fn(), create: jest.fn() };
  const scanSchedules = { updateById: jest.fn() };

  const processor = new SchedulerProcessor(scanQueue as unknown as Queue);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ microsoftTenants, scanJobs, scanSchedules } as never);
    microsoftTenants.findMany.mockResolvedValue([{ id: 'tenant-1', status: 'Consented' }]);
    scanJobs.findMany.mockResolvedValue([]); // no in-flight scan, by default
    scanJobs.create.mockResolvedValue({ id: 'scan-job-1' });
  });

  it('does nothing when no schedules are due', async () => {
    mockedFindDueScanSchedules.mockResolvedValue([]);

    await processor.process();

    expect(scanJobs.create).not.toHaveBeenCalled();
    expect(scanQueue.add).not.toHaveBeenCalled();
  });

  it('creates a ScanJob and enqueues it onto SCAN_QUEUE for a due schedule', async () => {
    mockedFindDueScanSchedules.mockResolvedValue([schedule()] as never);

    await processor.process();

    expect(scanJobs.create).toHaveBeenCalledWith(
      expect.objectContaining({ microsoftTenantId: 'tenant-1', status: 'Queued', triggerSource: 'Scheduled' }),
    );
    expect(scanQueue.add).toHaveBeenCalledWith('scan', { organizationId: 'org-1', scanJobId: 'scan-job-1' });
  });

  it('never sets triggeredByUserId — a scheduled scan has no human trigger', async () => {
    mockedFindDueScanSchedules.mockResolvedValue([schedule()] as never);

    await processor.process();

    const [createArgs] = scanJobs.create.mock.calls[0] as [Record<string, unknown>];
    expect(createArgs).not.toHaveProperty('triggeredByUserId');
  });

  it('advances nextRunAt and sets lastRunAt after a successful trigger', async () => {
    mockedFindDueScanSchedules.mockResolvedValue([schedule({ nextRunAt: new Date('2026-07-13T02:00:00.000Z') })] as never);

    await processor.process();

    expect(scanSchedules.updateById).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({
        lastRunAt: expect.any(Date),
        nextRunAt: expect.any(Date),
      }),
    );
    const [, updateData] = scanSchedules.updateById.mock.calls[0] as [string, { nextRunAt: Date }];
    // Daily schedule — next run should be ~24h after the previous target.
    expect(updateData.nextRunAt.getTime()).toBeGreaterThan(new Date('2026-07-13T02:00:00.000Z').getTime());
  });

  it('skips (does not duplicate) a schedule whose tenant already has a scan in progress, and leaves it due', async () => {
    scanJobs.findMany.mockResolvedValue([{ id: 'already-running', status: 'Running' }]);
    mockedFindDueScanSchedules.mockResolvedValue([schedule()] as never);

    await processor.process();

    expect(scanJobs.create).not.toHaveBeenCalled();
    expect(scanQueue.add).not.toHaveBeenCalled();
    expect(scanSchedules.updateById).not.toHaveBeenCalled(); // nextRunAt untouched — next tick retries
  });

  it('skips a schedule whose organization has zero connected Microsoft tenants', async () => {
    microsoftTenants.findMany.mockResolvedValue([]);
    mockedFindDueScanSchedules.mockResolvedValue([schedule()] as never);

    await processor.process();

    expect(scanJobs.create).not.toHaveBeenCalled();
  });

  it('skips a schedule whose organization has more than one connected Microsoft tenant (ambiguous)', async () => {
    microsoftTenants.findMany.mockResolvedValue([{ id: 'tenant-a' }, { id: 'tenant-b' }]);
    mockedFindDueScanSchedules.mockResolvedValue([schedule()] as never);

    await processor.process();

    expect(scanJobs.create).not.toHaveBeenCalled();
  });

  it('processes every due schedule even when one of them throws', async () => {
    mockedFindDueScanSchedules.mockResolvedValue([
      schedule({ id: 'schedule-bad', organizationId: 'org-bad' }),
      schedule({ id: 'schedule-good', organizationId: 'org-good' }),
    ] as never);
    mockedCreateContext.mockImplementation((organizationId: string) => {
      if (organizationId === 'org-bad') throw new Error('boom');
      return { microsoftTenants, scanJobs, scanSchedules } as never;
    });

    await processor.process();

    expect(scanJobs.create).toHaveBeenCalledTimes(1);
    expect(scanJobs.create).toHaveBeenCalledWith(expect.objectContaining({ microsoftTenantId: 'tenant-1' }));
  });
});
