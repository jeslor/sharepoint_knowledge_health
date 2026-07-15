import { prisma } from './client';
import { recoverStaleScanJobs } from './scan-recovery';

interface SeededScanJob {
  organizationId: string;
  scanJobId: string;
}

async function seedScanJob(
  label: string,
  overrides: { status: 'Queued' | 'Running' | 'Completed' | 'Failed'; startedAt: Date | null },
): Promise<SeededScanJob> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Scan Recovery Test Org ${unique}` },
  });

  const microsoftTenant = await prisma.microsoftTenant.create({
    data: {
      organizationId: organization.id,
      entraTenantId: `tenant-${unique}`,
      tenantName: `Test Tenant ${unique}`,
    },
  });

  const scanJob = await prisma.scanJob.create({
    data: {
      organizationId: organization.id,
      microsoftTenantId: microsoftTenant.id,
      status: overrides.status,
      startedAt: overrides.startedAt,
    },
  });

  return { organizationId: organization.id, scanJobId: scanJob.id };
}

describe('recoverStaleScanJobs (Phase 9.5 — the third sanctioned unscoped query)', () => {
  const now = new Date('2026-07-13T12:00:00.000Z');
  const staleAfterMs = 60 * 60 * 1000; // 1 hour, for this test's own arithmetic

  let staleOrgA: SeededScanJob;
  let staleOrgB: SeededScanJob;
  let freshlyRunningOrg: SeededScanJob;
  let alreadyCompletedOrg: SeededScanJob;

  beforeAll(async () => {
    // Two different organizations both stale — proves the query is
    // genuinely cross-tenant, not accidentally scoped to just one.
    staleOrgA = await seedScanJob('stale-a', { status: 'Running', startedAt: new Date('2026-07-13T09:00:00.000Z') });
    staleOrgB = await seedScanJob('stale-b', { status: 'Running', startedAt: new Date('2026-07-13T10:00:00.000Z') });
    freshlyRunningOrg = await seedScanJob('fresh', { status: 'Running', startedAt: new Date('2026-07-13T11:55:00.000Z') });
    alreadyCompletedOrg = await seedScanJob('completed', { status: 'Completed', startedAt: new Date('2026-07-13T08:00:00.000Z') });
  }, 30_000);

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [staleOrgA.organizationId, staleOrgB.organizationId, freshlyRunningOrg.organizationId, alreadyCompletedOrg.organizationId],
        },
      },
    });
    await prisma.$disconnect();
  }, 30_000);

  it('marks only Running jobs stuck past the threshold as Failed, across organizations', async () => {
    const recoveredCount = await recoverStaleScanJobs(now, staleAfterMs);

    expect(recoveredCount).toBe(2);

    const staleA = await prisma.scanJob.findUniqueOrThrow({ where: { id: staleOrgA.scanJobId } });
    expect(staleA.status).toBe('Failed');
    expect(staleA.completedAt).toEqual(now);
    expect(staleA.errorSummary).toMatch(/recovered automatically/i);

    const staleB = await prisma.scanJob.findUniqueOrThrow({ where: { id: staleOrgB.scanJobId } });
    expect(staleB.status).toBe('Failed');
  });

  it('leaves a Running job younger than the threshold untouched', async () => {
    await recoverStaleScanJobs(now, staleAfterMs);

    const fresh = await prisma.scanJob.findUniqueOrThrow({ where: { id: freshlyRunningOrg.scanJobId } });
    expect(fresh.status).toBe('Running');
    expect(fresh.errorSummary).toBeNull();
  });

  it('never touches an already-terminal ScanJob', async () => {
    await recoverStaleScanJobs(now, staleAfterMs);

    const completed = await prisma.scanJob.findUniqueOrThrow({ where: { id: alreadyCompletedOrg.scanJobId } });
    expect(completed.status).toBe('Completed');
    expect(completed.errorSummary).toBeNull();
  });
});
