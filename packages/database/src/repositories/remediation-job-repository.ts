import type { PrismaClient, Prisma, RemediationJob } from '@prisma/client';

export type RemediationJobCreateData = Omit<Prisma.RemediationJobUncheckedCreateInput, 'organizationId'>;
export type RemediationJobUpdateData = Omit<Prisma.RemediationJobUncheckedUpdateInput, 'organizationId' | 'id'>;

export class RemediationJobRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.RemediationJobFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.RemediationJobWhereInput },
  ): Promise<RemediationJob[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.remediationJob.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<RemediationJob | null> {
    return this.prisma.remediationJob.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.RemediationJobWhereInput }): Promise<number> {
    return this.prisma.remediationJob.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: RemediationJobCreateData): Promise<RemediationJob> {
    return this.prisma.remediationJob.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: RemediationJobUpdateData): Promise<RemediationJob | null> {
    const result = await this.prisma.remediationJob.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.remediationJob.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }

  /**
   * ADR-0022 Phase 4 — the exactly-once completion guard, without any new
   * locking primitive. Conditioned in the same query (`status: 'Running'`
   * in the WHERE, not a separate read-then-write) exactly like
   * applyVerifiedReadPermission/applyConsentAssertion (permission-state.ts,
   * ADR-0023) — so a concurrent/duplicate invocation of the same
   * RemediationJob can tell, from `advanced` alone, whether *this* call is
   * the one that actually transitioned Running -> Completed. Only that one
   * invocation should trigger a one-time side effect (enqueueing
   * notification reconciliation); every other concurrent/duplicate caller
   * finds `advanced: false` and does nothing further.
   */
  async markCompletedIfRunning(
    id: string,
    data: Omit<RemediationJobUpdateData, 'status'>,
  ): Promise<{ advanced: boolean }> {
    const result = await this.prisma.remediationJob.updateMany({
      where: { id, organizationId: this.organizationId, status: 'Running' },
      data: { ...data, status: 'Completed' },
    });
    return { advanced: result.count > 0 };
  }
}
