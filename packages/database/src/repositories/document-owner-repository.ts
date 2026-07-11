import type { PrismaClient, Prisma, DocumentOwner } from '@prisma/client';

export type DocumentOwnerCreateData = Omit<Prisma.DocumentOwnerUncheckedCreateInput, 'organizationId'>;
export type DocumentOwnerUpdateData = Omit<Prisma.DocumentOwnerUncheckedUpdateInput, 'organizationId' | 'id'>;

export class DocumentOwnerRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.DocumentOwnerFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.DocumentOwnerWhereInput },
  ): Promise<DocumentOwner[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.documentOwner.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<DocumentOwner | null> {
    return this.prisma.documentOwner.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.DocumentOwnerWhereInput }): Promise<number> {
    return this.prisma.documentOwner.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: DocumentOwnerCreateData): Promise<DocumentOwner> {
    return this.prisma.documentOwner.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: DocumentOwnerUpdateData): Promise<DocumentOwner | null> {
    const result = await this.prisma.documentOwner.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.documentOwner.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }
}
