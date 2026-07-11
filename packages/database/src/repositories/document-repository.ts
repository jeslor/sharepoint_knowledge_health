import type { PrismaClient, Prisma, Document } from '@prisma/client';

export type DocumentCreateData = Omit<Prisma.DocumentUncheckedCreateInput, 'organizationId'>;
export type DocumentUpdateData = Omit<Prisma.DocumentUncheckedUpdateInput, 'organizationId' | 'id'>;

export class DocumentRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.DocumentFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.DocumentWhereInput },
  ): Promise<Document[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.document.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<Document | null> {
    return this.prisma.document.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.DocumentWhereInput }): Promise<number> {
    return this.prisma.document.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: DocumentCreateData): Promise<Document> {
    return this.prisma.document.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: DocumentUpdateData): Promise<Document | null> {
    const result = await this.prisma.document.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.document.deleteMany({ where: { id, organizationId: this.organizationId } });
    return result.count > 0;
  }
}
