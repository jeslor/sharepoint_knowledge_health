import type { PrismaClient, Prisma, UpgradeRequest } from '@prisma/client';

export type UpgradeRequestCreateData = Omit<Prisma.UpgradeRequestUncheckedCreateInput, 'organizationId'>;

// Phase 6: create + findMany only — no updateById/deleteById yet, because
// nothing in this application transitions status (Pending/Contacted/
// Completed) or removes a row today. Matches OrganizationEntitlementRepository's
// own precedent of trimming a repository to exactly what's used, not a
// uniform maximal CRUD shape.
export class UpgradeRequestRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.UpgradeRequestFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.UpgradeRequestWhereInput },
  ): Promise<UpgradeRequest[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.upgradeRequest.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async create(data: UpgradeRequestCreateData): Promise<UpgradeRequest> {
    return this.prisma.upgradeRequest.create({ data: { ...data, organizationId: this.organizationId } });
  }
}
