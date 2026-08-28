import type { PrismaClient, Prisma, RemediationItem, RemediationItemStatus } from '@prisma/client';

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

  /**
   * ADR-0022 §8/§13, Phase 6 P0-2 (locked decision, Option A) — the
   * enqueue-failure compensating write. RemediationJobStatus has no Failed
   * value (unlike ScanJobStatus), so unlike scans.service.ts's compensating
   * write (flip the job itself to Failed), the compensating action here is
   * a bulk update of every item belonging to the just-created job to the
   * existing Skipped status, using the existing errorType/errorMessage
   * fields — no schema change. One unconditioned bulk updateMany, not a
   * conditioned one (unlike markCompletedIfRunning/resolveIfOpenOrInProgress):
   * this only ever runs once, synchronously, immediately after the items
   * were created in the same request — there is no concurrent caller to
   * race against.
   */
  async markSkippedForJob(remediationJobId: string, data: { errorType: string; errorMessage: string }): Promise<number> {
    const result = await this.prisma.remediationItem.updateMany({
      where: { remediationJobId, organizationId: this.organizationId },
      data: { status: 'Skipped', ...data },
    });
    return result.count;
  }

  /**
   * P0-3 (Phase 6 list/detail read APIs) — backs
   * RemediationService.listRemediationJobs's per-job succeeded/failed/skipped
   * counts. RemediationJob.succeededCount/failedCount are only written once,
   * at completion (RemediationJobRepository.markCompletedIfRunning), so they
   * read as stale zeros for a still-Running job; grouping live RemediationItem
   * rows by status is correct in both states and, same rationale as
   * GovernanceIssueRepository.groupByIssueType/groupByStatus, does this in
   * one aggregate query per page of jobs rather than fetching every item row
   * into Node to count there.
   */
  async groupByStatusForJobs(
    remediationJobIds: string[],
  ): Promise<{ remediationJobId: string; status: RemediationItemStatus; count: number }[]> {
    if (remediationJobIds.length === 0) return [];
    const results = await this.prisma.remediationItem.groupBy({
      by: ['remediationJobId', 'status'],
      where: { remediationJobId: { in: remediationJobIds }, organizationId: this.organizationId },
      _count: { _all: true },
    });
    return results.map((result) => ({
      remediationJobId: result.remediationJobId,
      status: result.status,
      count: result._count._all,
    }));
  }
}
