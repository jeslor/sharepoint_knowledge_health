import { Prisma } from '@prisma/client';
import type { PrismaClient, SharePointClassificationField } from '@prisma/client';

export type SharePointClassificationFieldCreateData = Omit<
  Prisma.SharePointClassificationFieldUncheckedCreateInput,
  'organizationId'
>;
export type SharePointClassificationFieldUpdateData = Omit<
  Prisma.SharePointClassificationFieldUncheckedUpdateInput,
  'organizationId' | 'id'
>;

/**
 * ADR-0025: tenant-designated classification columns per library. Mirrors
 * SharePointReviewDateMappingRepository, with one difference — a library may
 * have several classification fields, so lookups return arrays and identity
 * is (siteId, graphListId, columnDefinitionId).
 */
export class SharePointClassificationFieldRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  // All designated fields (Active and Stale) for a library — the config UI
  // needs to show stale ones so an admin can see/repair them.
  async findManyByLibrary(siteId: string, graphListId: string): Promise<SharePointClassificationField[]> {
    return this.prisma.sharePointClassificationField.findMany({
      where: { siteId, graphListId, organizationId: this.organizationId },
    });
  }

  // Only Active fields count toward taxonomy coverage — the worker/scoring
  // path uses this so stale fields are excluded from the denominator.
  async findManyActiveByLibrary(siteId: string, graphListId: string): Promise<SharePointClassificationField[]> {
    return this.prisma.sharePointClassificationField.findMany({
      where: { siteId, graphListId, organizationId: this.organizationId, status: 'Active' },
    });
  }

  // Every configured field for a site in one query (config table render),
  // avoiding N calls to findManyByLibrary.
  async findManyBySite(siteId: string): Promise<SharePointClassificationField[]> {
    return this.prisma.sharePointClassificationField.findMany({
      where: { siteId, organizationId: this.organizationId },
    });
  }

  // Atomic designate/re-activate of one column, matching the review-date
  // mapping's upsertActive race-hardening exactly: the unique constraint is
  // the real safety mechanism; a losing P2002 is resolved to a fetch.
  async upsertActive(input: {
    siteId: string;
    graphListId: string;
    columnDefinitionId: string;
    columnDisplayNameAtConfirmation: string;
    confirmedByUserId: string;
  }): Promise<SharePointClassificationField> {
    const { siteId, graphListId, columnDefinitionId, ...rest } = input;
    try {
      return await this.prisma.sharePointClassificationField.upsert({
        where: { siteId_graphListId_columnDefinitionId: { siteId, graphListId, columnDefinitionId } },
        create: { siteId, graphListId, columnDefinitionId, organizationId: this.organizationId, ...rest },
        update: { ...rest, status: 'Active', staleDetectedAt: null, confirmedAt: new Date() },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.sharePointClassificationField.findUniqueOrThrow({
          where: { siteId_graphListId_columnDefinitionId: { siteId, graphListId, columnDefinitionId } },
        });
      }
      throw error;
    }
  }

  async updateById(id: string, data: SharePointClassificationFieldUpdateData): Promise<SharePointClassificationField | null> {
    const result = await this.prisma.sharePointClassificationField.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.prisma.sharePointClassificationField.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  // Un-designate a column (config removal). Tenant-scoped delete.
  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.sharePointClassificationField.deleteMany({
      where: { id, organizationId: this.organizationId },
    });
    return result.count > 0;
  }
}
