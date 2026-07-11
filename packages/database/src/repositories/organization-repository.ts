import type { PrismaClient, Prisma, Organization } from '@prisma/client';

/**
 * Organization has no organizationId column — it IS the tenant root — so it
 * doesn't fit the standard tenant-scoped repository pattern used by the
 * other 8 models. It also has no create(): creating an Organization is a
 * bootstrap/signup operation that precedes any tenant context, out of scope
 * here (no auth yet).
 */
export class OrganizationRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async get(): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id: this.organizationId } });
  }

  async update(data: Omit<Prisma.OrganizationUncheckedUpdateInput, 'id'>): Promise<Organization> {
    return this.prisma.organization.update({ where: { id: this.organizationId }, data });
  }
}
