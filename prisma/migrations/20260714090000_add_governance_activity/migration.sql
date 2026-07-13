-- CreateEnum
CREATE TYPE "GovernanceActivityType" AS ENUM ('IssueCreated', 'IssueAssigned', 'AssigneeChanged', 'StatusChanged', 'ResolutionNoteUpdated', 'OwnerAssigned', 'OwnerRemoved', 'IssueReopened', 'IssueResolved');

-- CreateTable
CREATE TABLE "GovernanceActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "governanceIssueId" TEXT,
    "documentId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "activityType" "GovernanceActivityType" NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovernanceActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GovernanceActivity_organizationId_createdAt_idx" ON "GovernanceActivity"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "GovernanceActivity_governanceIssueId_createdAt_idx" ON "GovernanceActivity"("governanceIssueId", "createdAt");

-- CreateIndex
CREATE INDEX "GovernanceActivity_organizationId_activityType_idx" ON "GovernanceActivity"("organizationId", "activityType");

-- AddForeignKey
ALTER TABLE "GovernanceActivity" ADD CONSTRAINT "GovernanceActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceActivity" ADD CONSTRAINT "GovernanceActivity_governanceIssueId_fkey" FOREIGN KEY ("governanceIssueId") REFERENCES "GovernanceIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceActivity" ADD CONSTRAINT "GovernanceActivity_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceActivity" ADD CONSTRAINT "GovernanceActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
