import type { PrismaClient, Prisma, HealthSnapshot } from '@prisma/client';

export type HealthSnapshotCreateData = Omit<Prisma.HealthSnapshotUncheckedCreateInput, 'organizationId'>;
export type HealthSnapshotUpdateData = Omit<Prisma.HealthSnapshotUncheckedUpdateInput, 'organizationId' | 'id'>;

export class HealthSnapshotRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.HealthSnapshotFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.HealthSnapshotWhereInput },
  ): Promise<HealthSnapshot[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.healthSnapshot.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<HealthSnapshot | null> {
    return this.prisma.healthSnapshot.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.HealthSnapshotWhereInput }): Promise<number> {
    return this.prisma.healthSnapshot.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: HealthSnapshotCreateData): Promise<HealthSnapshot> {
    return this.prisma.healthSnapshot.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: HealthSnapshotUpdateData): Promise<HealthSnapshot | null> {
    const result = await this.prisma.healthSnapshot.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.healthSnapshot.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }
}
