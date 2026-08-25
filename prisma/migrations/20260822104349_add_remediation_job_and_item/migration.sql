-- CreateEnum
CREATE TYPE "RemediationJobStatus" AS ENUM ('Running', 'Completed');

-- CreateEnum
CREATE TYPE "RemediationItemStatus" AS ENUM ('Pending', 'Succeeded', 'Failed', 'Skipped');

-- CreateTable
CREATE TABLE "RemediationJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "issueType" "HealthIssueCriterion" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "RemediationJobStatus" NOT NULL DEFAULT 'Running',
    "initiatedByUserId" TEXT NOT NULL,
    "initiatedByRole" "UserRole" NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "succeededCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RemediationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemediationItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "remediationJobId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "RemediationItemStatus" NOT NULL DEFAULT 'Pending',
    "errorType" TEXT,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemediationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemediationJob_organizationId_status_idx" ON "RemediationJob"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RemediationItem_organizationId_status_idx" ON "RemediationItem"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RemediationItem_remediationJobId_status_idx" ON "RemediationItem"("remediationJobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RemediationItem_remediationJobId_documentId_key" ON "RemediationItem"("remediationJobId", "documentId");

-- AddForeignKey
ALTER TABLE "RemediationJob" ADD CONSTRAINT "RemediationJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationJob" ADD CONSTRAINT "RemediationJob_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationItem" ADD CONSTRAINT "RemediationItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationItem" ADD CONSTRAINT "RemediationItem_remediationJobId_fkey" FOREIGN KEY ("remediationJobId") REFERENCES "RemediationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationItem" ADD CONSTRAINT "RemediationItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
