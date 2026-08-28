import type { PrismaClient, Prisma, GovernanceIssue } from '@prisma/client';

export type GovernanceIssueCreateData = Omit<Prisma.GovernanceIssueUncheckedCreateInput, 'organizationId'>;
export type GovernanceIssueUpdateData = Omit<Prisma.GovernanceIssueUncheckedUpdateInput, 'organizationId' | 'id'>;

export class GovernanceIssueRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.GovernanceIssueFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.GovernanceIssueWhereInput },
  ): Promise<GovernanceIssue[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.governanceIssue.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<GovernanceIssue | null> {
    return this.prisma.governanceIssue.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.GovernanceIssueWhereInput }): Promise<number> {
    return this.prisma.governanceIssue.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: GovernanceIssueCreateData): Promise<GovernanceIssue> {
    return this.prisma.governanceIssue.create({ data: { ...data, organizationId: this.organizationId } });
  }

  async updateById(id: string, data: GovernanceIssueUpdateData): Promise<GovernanceIssue | null> {
    const result = await this.prisma.governanceIssue.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.governanceIssue.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }

  // Phase 1 work-queue summary strip: a single SQL-level GROUP BY, bounded
  // to at most one row per HealthIssueCriterion value (6 today) regardless
  // of how many GovernanceIssue rows exist underneath — the anti-pattern
  // this deliberately avoids is fetching every matching row into Node and
  // counting in application memory. Also reused as-is by
  // GovernanceIssuesService.getSummary() and GovernanceAnalyticsService's
  // issuesByType (scale-hardening pass) — same shape, same guarantee, no
  // need for a second, differently-scoped grouping method.
  async groupByIssueType(where: Prisma.GovernanceIssueWhereInput): Promise<{ issueType: string; count: number }[]> {
    const results = await this.prisma.governanceIssue.groupBy({
      by: ['issueType'],
      where: { ...where, organizationId: this.organizationId },
      _count: { _all: true },
    });
    return results.map((result) => ({ issueType: result.issueType, count: result._count._all }));
  }

  // Scale-hardening: same rationale as groupByIssueType above, grouped by
  // status instead — backs GovernanceAnalyticsService's statusDistribution
  // view, which previously fetched the full date-windowed cohort just to
  // bucket it by status in Node.
  async groupByStatus(where: Prisma.GovernanceIssueWhereInput): Promise<{ status: string; count: number }[]> {
    const results = await this.prisma.governanceIssue.groupBy({
      by: ['status'],
      where: { ...where, organizationId: this.organizationId },
      _count: { _all: true },
    });
    return results.map((result) => ({ status: result.status, count: result._count._all }));
  }

  /**
   * ADR-0022 §13.2 (Phase 5) — the automated-remediation resolution path's
   * exactly-once transition guard, mirroring RemediationJobRepository.markCompletedIfRunning
   * and permission-state.ts's applyVerifiedReadPermission/applyConsentAssertion
   * exactly: conditioned in the same query (status IN Open/InProgress in the
   * WHERE, not a separate read-then-write), so a concurrent/duplicate
   * resolution attempt for the same GovernanceIssue can tell, from
   * `advanced` alone, whether *this* call is the one that actually
   * transitioned it — which is what governance-resolution.ts uses to
   * decide whether to write the one accompanying GovernanceActivity row.
   * Deliberately bypasses GovernanceIssuesService/ALLOWED_TRANSITIONS
   * (apps/api, HTTP-guarded, human-facing) — this is the narrow,
   * explicitly-approved exception ADR-0022 §13.2 authorizes, not a
   * bypass of authorization (the caller has already resolved authorization
   * at RemediationJob-creation time, per ADR-0022 §8).
   */
  async resolveIfOpenOrInProgress(id: string, data: { resolvedAt: Date }): Promise<{ advanced: boolean }> {
    const result = await this.prisma.governanceIssue.updateMany({
      where: { id, organizationId: this.organizationId, status: { in: ['Open', 'InProgress'] } },
      data: { ...data, status: 'Resolved' },
    });
    return { advanced: result.count > 0 };
  }
}
