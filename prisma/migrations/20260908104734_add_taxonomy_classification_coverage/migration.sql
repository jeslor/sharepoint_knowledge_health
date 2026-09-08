-- CreateEnum
CREATE TYPE "SharePointClassificationFieldStatus" AS ENUM ('Active', 'Stale');

-- AlterEnum
ALTER TYPE "HealthIssueCriterion" ADD VALUE 'Taxonomy';

-- AlterTable
ALTER TABLE "HealthScore" ADD COLUMN     "taxonomyScore" INTEGER;

-- CreateTable
CREATE TABLE "SharePointClassificationField" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "graphListId" TEXT NOT NULL,
    "columnDefinitionId" TEXT NOT NULL,
    "columnDisplayNameAtConfirmation" TEXT NOT NULL,
    "status" "SharePointClassificationFieldStatus" NOT NULL DEFAULT 'Active',
    "staleDetectedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharePointClassificationField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharePointClassificationField_organizationId_idx" ON "SharePointClassificationField"("organizationId");

-- CreateIndex
CREATE INDEX "SharePointClassificationField_siteId_graphListId_status_idx" ON "SharePointClassificationField"("siteId", "graphListId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SharePointClassificationField_siteId_graphListId_columnDefi_key" ON "SharePointClassificationField"("siteId", "graphListId", "columnDefinitionId");

-- AddForeignKey
ALTER TABLE "SharePointClassificationField" ADD CONSTRAINT "SharePointClassificationField_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharePointClassificationField" ADD CONSTRAINT "SharePointClassificationField_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "SharePointSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharePointClassificationField" ADD CONSTRAINT "SharePointClassificationField_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
