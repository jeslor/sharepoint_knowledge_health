import { prisma } from './client';
import { recoverStaleDiscoveries } from './discovery-recovery';

interface SeededTenant {
  organizationId: string;
  microsoftTenantId: string;
}

async function seedTenant(
  label: string,
  overrides: { discoveryStatus: 'NotStarted' | 'Queued' | 'Running' | 'Completed' | 'Failed'; discoveryStartedAt: Date | null },
): Promise<SeededTenant> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Discovery Recovery Test Org ${unique}` },
  });

  const microsoftTenant = await prisma.microsoftTenant.create({
    data: {
      organizationId: organization.id,
      entraTenantId: `tenant-${unique}`,
      tenantName: `Test Tenant ${unique}`,
      discoveryStatus: overrides.discoveryStatus,
      discoveryStartedAt: overrides.discoveryStartedAt,
    },
  });

  return { organizationId: organization.id, microsoftTenantId: microsoftTenant.id };
}

describe('recoverStaleDiscoveries (mirrors recoverStaleScanJobs — the fourth sanctioned unscoped query)', () => {
  const now = new Date('2026-07-21T12:00:00.000Z');
  const staleAfterMs = 60 * 60 * 1000; // 1 hour

  let staleOrgA: SeededTenant;
  let staleOrgB: SeededTenant;
  let freshlyRunningOrg: SeededTenant;
  let alreadyCompletedOrg: SeededTenant;
  let neverStartedOrg: SeededTenant;

  beforeAll(async () => {
    // Two different organizations both stale — proves the query is
    // genuinely cross-tenant, not accidentally scoped to just one.
    staleOrgA = await seedTenant('stale-a', { discoveryStatus: 'Running', discoveryStartedAt: new Date('2026-07-21T09:00:00.000Z') });
    staleOrgB = await seedTenant('stale-b', { discoveryStatus: 'Running', discoveryStartedAt: new Date('2026-07-21T10:00:00.000Z') });
    freshlyRunningOrg = await seedTenant('fresh', { discoveryStatus: 'Running', discoveryStartedAt: new Date('2026-07-21T11:55:00.000Z') });
    alreadyCompletedOrg = await seedTenant('completed', { discoveryStatus: 'Completed', discoveryStartedAt: new Date('2026-07-21T08:00:00.000Z') });
    // discoveryStartedAt: null — never reached Running (still Queued, or
    // NotStarted) — must never match discoveryStartedAt: { lt: cutoff }.
    neverStartedOrg = await seedTenant('queued', { discoveryStatus: 'Queued', discoveryStartedAt: null });
  }, 30_000);

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: {
        id: {
          in: [
            staleOrgA.organizationId,
            staleOrgB.organizationId,
            freshlyRunningOrg.organizationId,
            alreadyCompletedOrg.organizationId,
            neverStartedOrg.organizationId,
          ],
        },
      },
    });
    await prisma.$disconnect();
  }, 30_000);

  it('marks only Running tenants stuck past the threshold as Failed, across organizations', async () => {
    const recoveredCount = await recoverStaleDiscoveries(now, staleAfterMs);

    expect(recoveredCount).toBe(2);

    const staleA = await prisma.microsoftTenant.findUniqueOrThrow({ where: { id: staleOrgA.microsoftTenantId } });
    expect(staleA.discoveryStatus).toBe('Failed');
    expect(staleA.discoveryCompletedAt).toEqual(now);
    expect(staleA.discoveryError).toMatch(/recovered automatically/i);

    const staleB = await prisma.microsoftTenant.findUniqueOrThrow({ where: { id: staleOrgB.microsoftTenantId } });
    expect(staleB.discoveryStatus).toBe('Failed');
  });

  it('leaves a Running discovery younger than the threshold untouched', async () => {
    await recoverStaleDiscoveries(now, staleAfterMs);

    const fresh = await prisma.microsoftTenant.findUniqueOrThrow({ where: { id: freshlyRunningOrg.microsoftTenantId } });
    expect(fresh.discoveryStatus).toBe('Running');
    expect(fresh.discoveryError).toBeNull();
  });

  it('never touches an already-terminal discoveryStatus', async () => {
    await recoverStaleDiscoveries(now, staleAfterMs);

    const completed = await prisma.microsoftTenant.findUniqueOrThrow({ where: { id: alreadyCompletedOrg.microsoftTenantId } });
    expect(completed.discoveryStatus).toBe('Completed');
    expect(completed.discoveryError).toBeNull();
  });

  it('never touches a Queued tenant that never reached Running (discoveryStartedAt is null, not stale by this check)', async () => {
    await recoverStaleDiscoveries(now, staleAfterMs);

    const queued = await prisma.microsoftTenant.findUniqueOrThrow({ where: { id: neverStartedOrg.microsoftTenantId } });
    expect(queued.discoveryStatus).toBe('Queued');
  });
});
