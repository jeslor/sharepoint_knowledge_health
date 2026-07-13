import type { PrismaClient, Prisma, GovernanceActivity } from '@prisma/client';

export type GovernanceActivityCreateData = Omit<Prisma.GovernanceActivityUncheckedCreateInput, 'organizationId'>;

// Deliberately no update/delete data type and no updateById/deleteById
// method below — append-only is enforced by this repository's public
// shape itself (ADR-0016 implementation notes / Phase 8C), the same
// discipline ADR-0013 §8 already established for packages/graph-client's
// read-only surface: "read-only is enforced by the public API shape
// itself, not just by the granted permissions."
export class GovernanceActivityRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.GovernanceActivityFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.GovernanceActivityWhereInput },
  ): Promise<GovernanceActivity[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.governanceActivity.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<GovernanceActivity | null> {
    return this.prisma.governanceActivity.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.GovernanceActivityWhereInput }): Promise<number> {
    return this.prisma.governanceActivity.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: GovernanceActivityCreateData): Promise<GovernanceActivity> {
    return this.prisma.governanceActivity.create({ data: { ...data, organizationId: this.organizationId } });
  }
}
