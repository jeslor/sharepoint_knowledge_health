-- CreateEnum
CREATE TYPE "SharePointReviewDateMappingStatus" AS ENUM ('Active', 'Stale');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "graphListId" TEXT;

-- CreateTable
CREATE TABLE "SharePointReviewDateMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "graphListId" TEXT NOT NULL,
    "columnDefinitionId" TEXT NOT NULL,
    "columnDisplayNameAtConfirmation" TEXT NOT NULL,
    "status" "SharePointReviewDateMappingStatus" NOT NULL DEFAULT 'Active',
    "staleDetectedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharePointReviewDateMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharePointReviewDateMapping_organizationId_idx" ON "SharePointReviewDateMapping"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SharePointReviewDateMapping_siteId_graphListId_key" ON "SharePointReviewDateMapping"("siteId", "graphListId");

-- AddForeignKey
ALTER TABLE "SharePointReviewDateMapping" ADD CONSTRAINT "SharePointReviewDateMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharePointReviewDateMapping" ADD CONSTRAINT "SharePointReviewDateMapping_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "SharePointSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharePointReviewDateMapping" ADD CONSTRAINT "SharePointReviewDateMapping_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
