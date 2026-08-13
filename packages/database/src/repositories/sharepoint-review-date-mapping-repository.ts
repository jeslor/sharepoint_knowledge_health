import { Prisma } from '@prisma/client';
import type { PrismaClient, SharePointReviewDateMapping } from '@prisma/client';

export type SharePointReviewDateMappingCreateData = Omit<
  Prisma.SharePointReviewDateMappingUncheckedCreateInput,
  'organizationId'
>;
export type SharePointReviewDateMappingUpdateData = Omit<
  Prisma.SharePointReviewDateMappingUncheckedUpdateInput,
  'organizationId' | 'id'
>;

export class SharePointReviewDateMappingRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  // One row per (siteId, graphListId) — @@unique enforces this at the DB
  // level; this is the lookup the worker's sync step and the confirm
  // action both use to find (or detect the absence of) an active mapping.
  async findByLibrary(siteId: string, graphListId: string): Promise<SharePointReviewDateMapping | null> {
    return this.prisma.sharePointReviewDateMapping.findFirst({
      where: { siteId, graphListId, organizationId: this.organizationId },
    });
  }

  async create(data: SharePointReviewDateMappingCreateData): Promise<SharePointReviewDateMapping> {
    return this.prisma.sharePointReviewDateMapping.create({ data: { ...data, organizationId: this.organizationId } });
  }

  // Phase 2: the Review Date library list needs every mapping for a site
  // in one query, not N calls to findByLibrary — avoids N+1 when
  // rendering a table of libraries.
  async findManyBySite(siteId: string): Promise<SharePointReviewDateMapping[]> {
    return this.prisma.sharePointReviewDateMapping.findMany({ where: { siteId, organizationId: this.organizationId } });
  }

  // Confirmation-race hardening: an atomic DB upsert (not a findByLibrary-
  // then-create/update sequence) so two simultaneous first-time
  // confirmations of the same library can't both pass an existence check
  // and both attempt create(). Mirrors NotificationRepository.
  // upsertByDedupeKey's exact precedent — under genuinely simultaneous
  // execution, upsert() itself can still have both callers miss the
  // existing row and both attempt the create branch; the @@unique([siteId,
  // graphListId]) constraint guarantees only one insert wins, and the
  // loser's P2002 is caught here and turned into a fetch of the row that
  // now definitely exists, rather than an unhandled 500. No locking
  // infrastructure, no schema change — the existing unique constraint
  // remains the actual safety mechanism.
  async upsertActive(input: {
    siteId: string;
    graphListId: string;
    columnDefinitionId: string;
    columnDisplayNameAtConfirmation: string;
    confirmedByUserId: string;
  }): Promise<SharePointReviewDateMapping> {
    const { siteId, graphListId, ...rest } = input;
    try {
      return await this.prisma.sharePointReviewDateMapping.upsert({
        where: { siteId_graphListId: { siteId, graphListId } },
        create: { siteId, graphListId, organizationId: this.organizationId, ...rest },
        update: { ...rest, status: 'Active', staleDetectedAt: null, confirmedAt: new Date() },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.sharePointReviewDateMapping.findUniqueOrThrow({
          where: { siteId_graphListId: { siteId, graphListId } },
        });
      }
      throw error;
    }
  }

  async updateById(id: string, data: SharePointReviewDateMappingUpdateData): Promise<SharePointReviewDateMapping | null> {
    const result = await this.prisma.sharePointReviewDateMapping.updateMany({
      where: { id, organizationId: this.organizationId },
      data,
    });
    if (result.count === 0) return null;
    return this.prisma.sharePointReviewDateMapping.findFirst({ where: { id, organizationId: this.organizationId } });
  }
}
