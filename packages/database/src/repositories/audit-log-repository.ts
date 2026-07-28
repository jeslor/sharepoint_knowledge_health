import type { PrismaClient, Prisma, AuditLog } from '@prisma/client';

export type AuditLogCreateData = Omit<Prisma.AuditLogUncheckedCreateInput, 'organizationId'>;

// Deliberately no update/delete data type and no updateById/deleteById
// method below — append-only is enforced by this repository's public shape
// itself (ADR-0019), the same discipline GovernanceActivityRepository
// already established: "read-only is enforced by the public API shape
// itself, not just by the granted permissions" (ADR-0013 §8), applied here
// to writes instead of reads.
export class AuditLogRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.AuditLogFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.AuditLogWhereInput },
  ): Promise<AuditLog[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.auditLog.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<AuditLog | null> {
    return this.prisma.auditLog.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.AuditLogWhereInput }): Promise<number> {
    return this.prisma.auditLog.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: AuditLogCreateData): Promise<AuditLog> {
    return this.prisma.auditLog.create({ data: { ...data, organizationId: this.organizationId } });
  }
}
