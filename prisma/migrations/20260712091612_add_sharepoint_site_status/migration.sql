-- CreateEnum
CREATE TYPE "SharePointSiteStatus" AS ENUM ('Discovered', 'Approved', 'Removed');

-- AlterTable
ALTER TABLE "SharePointSite" ADD COLUMN "status" "SharePointSiteStatus" NOT NULL DEFAULT 'Discovered';
ALTER TABLE "SharePointSite" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "SharePointSite" ADD COLUMN "approvedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "SharePointSite_organizationId_status_idx" ON "SharePointSite"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "SharePointSite" ADD CONSTRAINT "SharePointSite_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
