import type { PrismaClient, Prisma, ScanSchedule } from '@prisma/client';

export type ScanScheduleCreateData = Omit<Prisma.ScanScheduleUncheckedCreateInput, 'organizationId'>;
export type ScanScheduleUpdateData = Omit<Prisma.ScanScheduleUncheckedUpdateInput, 'organizationId' | 'id'>;

export class ScanScheduleRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.ScanScheduleFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.ScanScheduleWhereInput },
  ): Promise<ScanSchedule[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.scanSchedule.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<ScanSchedule | null> {
    return this.prisma.scanSchedule.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.ScanScheduleWhereInput }): Promise<number> {
    return this.prisma.scanSchedule.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: ScanScheduleCreateData): Promise<ScanSchedule> {
    return this.prisma.scanSchedule.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: ScanScheduleUpdateData): Promise<ScanSchedule | null> {
    const result = await this.prisma.scanSchedule.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.scanSchedule.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }
}
