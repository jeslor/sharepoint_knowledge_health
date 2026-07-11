import type { PrismaClient, Prisma, MicrosoftTenant } from '@prisma/client';

export type MicrosoftTenantCreateData = Omit<Prisma.MicrosoftTenantUncheckedCreateInput, 'organizationId'>;
export type MicrosoftTenantUpdateData = Omit<Prisma.MicrosoftTenantUncheckedUpdateInput, 'organizationId' | 'id'>;

export class MicrosoftTenantRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.MicrosoftTenantFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.MicrosoftTenantWhereInput },
  ): Promise<MicrosoftTenant[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.microsoftTenant.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<MicrosoftTenant | null> {
    return this.prisma.microsoftTenant.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.MicrosoftTenantWhereInput }): Promise<number> {
    return this.prisma.microsoftTenant.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: MicrosoftTenantCreateData): Promise<MicrosoftTenant> {
    return this.prisma.microsoftTenant.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: MicrosoftTenantUpdateData): Promise<MicrosoftTenant | null> {
    const result = await this.prisma.microsoftTenant.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.microsoftTenant.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }
}
