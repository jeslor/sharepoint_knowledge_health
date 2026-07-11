import type { PrismaClient, Prisma, ScanJob } from '@prisma/client';

export type ScanJobCreateData = Omit<Prisma.ScanJobUncheckedCreateInput, 'organizationId'>;
export type ScanJobUpdateData = Omit<Prisma.ScanJobUncheckedUpdateInput, 'organizationId' | 'id'>;

export class ScanJobRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.ScanJobFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.ScanJobWhereInput },
  ): Promise<ScanJob[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.scanJob.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<ScanJob | null> {
    return this.prisma.scanJob.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.ScanJobWhereInput }): Promise<number> {
    return this.prisma.scanJob.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: ScanJobCreateData): Promise<ScanJob> {
    return this.prisma.scanJob.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: ScanJobUpdateData): Promise<ScanJob | null> {
    const result = await this.prisma.scanJob.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.scanJob.deleteMany({ where: { id, organizationId: this.organizationId } });
    return result.count > 0;
  }
}
