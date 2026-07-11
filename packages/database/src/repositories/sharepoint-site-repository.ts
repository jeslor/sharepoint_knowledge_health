import type { PrismaClient, Prisma, SharePointSite } from '@prisma/client';

export type SharePointSiteCreateData = Omit<Prisma.SharePointSiteUncheckedCreateInput, 'organizationId'>;
export type SharePointSiteUpdateData = Omit<Prisma.SharePointSiteUncheckedUpdateInput, 'organizationId' | 'id'>;

export class SharePointSiteRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.SharePointSiteFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.SharePointSiteWhereInput },
  ): Promise<SharePointSite[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.sharePointSite.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<SharePointSite | null> {
    return this.prisma.sharePointSite.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.SharePointSiteWhereInput }): Promise<number> {
    return this.prisma.sharePointSite.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: SharePointSiteCreateData): Promise<SharePointSite> {
    return this.prisma.sharePointSite.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: SharePointSiteUpdateData): Promise<SharePointSite | null> {
    const result = await this.prisma.sharePointSite.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.sharePointSite.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }
}
