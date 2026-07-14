import { prisma } from './client';
import { findDueScanSchedules } from './scheduler';

interface SeededSchedule {
  organizationId: string;
  scanScheduleId: string;
}

async function seedOrgWithSchedule(
  label: string,
  overrides: { enabled?: boolean; nextRunAt: Date },
): Promise<SeededSchedule> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Scheduler Test Org ${unique}` },
  });

  const schedule = await prisma.scanSchedule.create({
    data: {
      organizationId: organization.id,
      frequency: 'Daily',
      enabled: overrides.enabled ?? true,
      nextRunAt: overrides.nextRunAt,
    },
  });

  return { organizationId: organization.id, scanScheduleId: schedule.id };
}

describe('findDueScanSchedules (ADR-0015 §1 — the second sanctioned unscoped query)', () => {
  const now = new Date('2026-07-13T09:00:00.000Z');
  const past = new Date('2026-07-13T08:00:00.000Z');
  const future = new Date('2026-07-14T09:00:00.000Z');

  let dueOrgA: SeededSchedule;
  let dueOrgB: SeededSchedule;
  let notYetDueOrg: SeededSchedule;
  let disabledOrg: SeededSchedule;

  beforeAll(async () => {
    // Two different organizations both due — proves the query is
    // genuinely cross-tenant, not accidentally scoped to just one.
    dueOrgA = await seedOrgWithSchedule('due-a', { nextRunAt: past });
    dueOrgB = await seedOrgWithSchedule('due-b', { nextRunAt: now });
    notYetDueOrg = await seedOrgWithSchedule('not-yet-due', { nextRunAt: future });
    disabledOrg = await seedOrgWithSchedule('disabled', { enabled: false, nextRunAt: past });
  }, 30_000);

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [dueOrgA.organizationId, dueOrgB.organizationId, notYetDueOrg.organizationId, disabledOrg.organizationId],
        },
      },
    });
    await prisma.$disconnect();
  }, 30_000);

  it('returns due, enabled schedules from every organization, not just one', async () => {
    const results = await findDueScanSchedules(now);
    const ids = results.map((s) => s.id);

    expect(ids).toContain(dueOrgA.scanScheduleId);
    expect(ids).toContain(dueOrgB.scanScheduleId);
  });

  it('excludes a schedule whose nextRunAt is still in the future', async () => {
    const results = await findDueScanSchedules(now);
    expect(results.some((s) => s.id === notYetDueOrg.scanScheduleId)).toBe(false);
  });

  it('excludes a disabled schedule even if it is overdue', async () => {
    const results = await findDueScanSchedules(now);
    expect(results.some((s) => s.id === disabledOrg.scanScheduleId)).toBe(false);
  });
});
