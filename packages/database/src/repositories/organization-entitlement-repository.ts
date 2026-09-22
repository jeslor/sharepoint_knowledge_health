import type { PrismaClient, Prisma, OrganizationEntitlement } from '@prisma/client';

export type OrganizationEntitlementCreateData = Omit<Prisma.OrganizationEntitlementUncheckedCreateInput, 'organizationId'>;
export type OrganizationEntitlementUpdateData = Omit<Prisma.OrganizationEntitlementUncheckedUpdateInput, 'organizationId' | 'id'>;

/**
 * One row per organization (organizationId is unique) — same singleton
 * shape as OrganizationRepository itself, not the id-based CRUD shape most
 * other repositories use (ScanSchedule, Document, etc.), because there is
 * no independent "look up entitlement by its own id" use case: every
 * caller wants "this organization's entitlement," never an arbitrary one.
 *
 * Plain reads/writes only. The concurrency-safe quota consume/release
 * operations deliberately do NOT live here — see entitlement.ts's module
 * comment for why a repository method bound to a single `this.prisma`
 * can't provide the transaction-composability those operations require.
 */
export class OrganizationEntitlementRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async get(): Promise<OrganizationEntitlement | null> {
    return this.prisma.organizationEntitlement.findUnique({ where: { organizationId: this.organizationId } });
  }

  async create(data: OrganizationEntitlementCreateData): Promise<OrganizationEntitlement> {
    return this.prisma.organizationEntitlement.create({ data: { ...data, organizationId: this.organizationId } });
  }

  // updateMany + recheck (not a bare `.update()`), matching
  // ScanScheduleRepository.updateById's precedent — a no-op returns null
  // instead of Prisma throwing when the row doesn't exist yet, so a
  // caller can distinguish "not created yet" from a real error.
  async update(data: OrganizationEntitlementUpdateData): Promise<OrganizationEntitlement | null> {
    const result = await this.prisma.organizationEntitlement.updateMany({
      where: { organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.get();
  }
}
