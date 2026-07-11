import type { PrismaClient, Prisma, User } from '@prisma/client';

export type UserCreateData = Omit<Prisma.UserUncheckedCreateInput, 'organizationId'>;
export type UserUpdateData = Omit<Prisma.UserUncheckedUpdateInput, 'organizationId' | 'id'>;

export class UserRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.UserFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.UserWhereInput },
  ): Promise<User[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.user.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.UserWhereInput }): Promise<number> {
    return this.prisma.user.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: UserCreateData): Promise<User> {
    return this.prisma.user.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: UserUpdateData): Promise<User | null> {
    const result = await this.prisma.user.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.user.deleteMany({ where: { id, organizationId: this.organizationId } });
    return result.count > 0;
  }
}
