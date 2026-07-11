import type { PrismaClient, Prisma, HealthScore } from '@prisma/client';

export type HealthScoreCreateData = Omit<Prisma.HealthScoreUncheckedCreateInput, 'organizationId'>;
export type HealthScoreUpdateData = Omit<Prisma.HealthScoreUncheckedUpdateInput, 'organizationId' | 'id'>;

export class HealthScoreRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.HealthScoreFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.HealthScoreWhereInput },
  ): Promise<HealthScore[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.healthScore.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<HealthScore | null> {
    return this.prisma.healthScore.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.HealthScoreWhereInput }): Promise<number> {
    return this.prisma.healthScore.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: HealthScoreCreateData): Promise<HealthScore> {
    return this.prisma.healthScore.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: HealthScoreUpdateData): Promise<HealthScore | null> {
    const result = await this.prisma.healthScore.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.healthScore.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }
}
