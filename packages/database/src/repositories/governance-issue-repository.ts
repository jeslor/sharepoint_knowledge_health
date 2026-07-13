import type { PrismaClient, Prisma, GovernanceIssue } from '@prisma/client';

export type GovernanceIssueCreateData = Omit<Prisma.GovernanceIssueUncheckedCreateInput, 'organizationId'>;
export type GovernanceIssueUpdateData = Omit<Prisma.GovernanceIssueUncheckedUpdateInput, 'organizationId' | 'id'>;

export class GovernanceIssueRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.GovernanceIssueFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.GovernanceIssueWhereInput },
  ): Promise<GovernanceIssue[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.governanceIssue.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<GovernanceIssue | null> {
    return this.prisma.governanceIssue.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.GovernanceIssueWhereInput }): Promise<number> {
    return this.prisma.governanceIssue.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: GovernanceIssueCreateData): Promise<GovernanceIssue> {
    return this.prisma.governanceIssue.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: GovernanceIssueUpdateData): Promise<GovernanceIssue | null> {
    const result = await this.prisma.governanceIssue.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.governanceIssue.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }
}
