import type { PrismaClient, Prisma, RemediationItem } from '@prisma/client';

export type RemediationItemCreateData = Omit<Prisma.RemediationItemUncheckedCreateInput, 'organizationId'>;
export type RemediationItemUpdateData = Omit<Prisma.RemediationItemUncheckedUpdateInput, 'organizationId' | 'id'>;

export class RemediationItemRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.RemediationItemFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.RemediationItemWhereInput },
  ): Promise<RemediationItem[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.remediationItem.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<RemediationItem | null> {
    return this.prisma.remediationItem.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.RemediationItemWhereInput }): Promise<number> {
    return this.prisma.remediationItem.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: RemediationItemCreateData): Promise<RemediationItem> {
    return this.prisma.remediationItem.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: RemediationItemUpdateData): Promise<RemediationItem | null> {
    const result = await this.prisma.remediationItem.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.remediationItem.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }
}
