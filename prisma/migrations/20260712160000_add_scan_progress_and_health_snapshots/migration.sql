-- AlterTable
ALTER TABLE "ScanJob" ADD COLUMN     "totalSites" INTEGER,
ADD COLUMN     "sitesCompleted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currentSiteName" TEXT;

-- CreateTable
CREATE TABLE "HealthSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scanJobId" TEXT NOT NULL,
    "totalDocumentsScanned" INTEGER NOT NULL,
    "averageHealthScore" INTEGER,
    "criticalIssuesCount" INTEGER NOT NULL,
    "warningIssuesCount" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HealthSnapshot_scanJobId_key" ON "HealthSnapshot"("scanJobId");

-- CreateIndex
CREATE INDEX "HealthSnapshot_organizationId_capturedAt_idx" ON "HealthSnapshot"("organizationId", "capturedAt");

-- AddForeignKey
ALTER TABLE "HealthSnapshot" ADD CONSTRAINT "HealthSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSnapshot" ADD CONSTRAINT "HealthSnapshot_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
