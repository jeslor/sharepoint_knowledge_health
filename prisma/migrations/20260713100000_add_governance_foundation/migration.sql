-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'GovernanceManager';

-- CreateEnum
CREATE TYPE "GovernanceIssueStatus" AS ENUM ('Open', 'InProgress', 'Resolved');

-- CreateEnum
CREATE TYPE "DocumentReviewDateSource" AS ENUM ('Manual', 'GraphMetadata');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "nextReviewDueAt" TIMESTAMP(3),
ADD COLUMN     "reviewDateSource" "DocumentReviewDateSource" NOT NULL DEFAULT 'Manual';

-- AlterTable
ALTER TABLE "DocumentOwner" ADD COLUMN     "assignedByUserId" TEXT,
ADD COLUMN     "assignedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GovernanceIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "issueType" "HealthIssueCriterion" NOT NULL,
    "severity" "HealthIssueSeverity" NOT NULL,
    "status" "GovernanceIssueStatus" NOT NULL DEFAULT 'Open',
    "assignedUserId" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "GovernanceIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_organizationId_nextReviewDueAt_idx" ON "Document"("organizationId", "nextReviewDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceIssue_documentId_issueType_key" ON "GovernanceIssue"("documentId", "issueType");

-- CreateIndex
CREATE INDEX "GovernanceIssue_organizationId_status_idx" ON "GovernanceIssue"("organizationId", "status");

-- CreateIndex
CREATE INDEX "GovernanceIssue_assignedUserId_idx" ON "GovernanceIssue"("assignedUserId");

-- AddForeignKey
ALTER TABLE "DocumentOwner" ADD CONSTRAINT "DocumentOwner_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceIssue" ADD CONSTRAINT "GovernanceIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceIssue" ADD CONSTRAINT "GovernanceIssue_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovernanceIssue" ADD CONSTRAINT "GovernanceIssue_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
