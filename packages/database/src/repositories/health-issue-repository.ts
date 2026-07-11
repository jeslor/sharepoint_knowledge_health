import type { PrismaClient, Prisma, HealthIssue } from '@prisma/client';

export type HealthIssueCreateData = Omit<Prisma.HealthIssueUncheckedCreateInput, 'organizationId'>;
export type HealthIssueUpdateData = Omit<Prisma.HealthIssueUncheckedUpdateInput, 'organizationId' | 'id'>;

export class HealthIssueRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.HealthIssueFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.HealthIssueWhereInput },
  ): Promise<HealthIssue[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.healthIssue.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<HealthIssue | null> {
    return this.prisma.healthIssue.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.HealthIssueWhereInput }): Promise<number> {
    return this.prisma.healthIssue.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: HealthIssueCreateData): Promise<HealthIssue> {
    return this.prisma.healthIssue.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: HealthIssueUpdateData): Promise<HealthIssue | null> {
    const result = await this.prisma.healthIssue.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.healthIssue.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }
}
