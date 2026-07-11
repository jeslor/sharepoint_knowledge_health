-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('Active', 'Suspended');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('Admin', 'Member');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('Active', 'Deactivated');

-- CreateEnum
CREATE TYPE "MicrosoftTenantStatus" AS ENUM ('PendingConsent', 'Consented', 'Revoked');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('Active', 'Removed');

-- CreateEnum
CREATE TYPE "DocumentOwnerType" AS ENUM ('Author', 'AssignedOwner', 'Unknown');

-- CreateEnum
CREATE TYPE "DocumentOwnerSource" AS ENUM ('GraphMetadata', 'ManualAssignment');

-- CreateEnum
CREATE TYPE "ScanJobStatus" AS ENUM ('Queued', 'Running', 'Completed', 'Failed', 'Cancelled');

-- CreateEnum
CREATE TYPE "HealthBand" AS ENUM ('Healthy', 'NeedsAttention', 'RequiresReview');

-- CreateEnum
CREATE TYPE "HealthIssueCriterion" AS ENUM ('Freshness', 'Ownership', 'ReviewStatus', 'Metadata', 'Duplication', 'Age');

-- CreateEnum
CREATE TYPE "HealthIssueSeverity" AS ENUM ('NeedsAttention', 'RequiresReview');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entraObjectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'Member',
    "status" "UserStatus" NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MicrosoftTenant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entraTenantId" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "status" "MicrosoftTenantStatus" NOT NULL DEFAULT 'PendingConsent',
    "consentGrantedAt" TIMESTAMP(3),
    "consentGrantedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MicrosoftTenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharePointSite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "microsoftTenantId" TEXT NOT NULL,
    "graphSiteId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharePointSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "graphItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
    "sourceModifiedAt" TIMESTAMP(3) NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'Active',
    "currentHealthScoreId" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentOwner" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerType" "DocumentOwnerType" NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "source" "DocumentOwnerSource" NOT NULL,

    CONSTRAINT "DocumentOwner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "microsoftTenantId" TEXT NOT NULL,
    "triggeredByUserId" TEXT NOT NULL,
    "status" "ScanJobStatus" NOT NULL DEFAULT 'Queued',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "documentsScanned" INTEGER NOT NULL DEFAULT 0,
    "documentsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "scanJobId" TEXT NOT NULL,
    "compositeScore" INTEGER NOT NULL,
    "freshnessScore" INTEGER NOT NULL,
    "ownershipScore" INTEGER NOT NULL,
    "reviewStatusScore" INTEGER NOT NULL,
    "metadataScore" INTEGER NOT NULL,
    "duplicationScore" INTEGER NOT NULL,
    "ageScore" INTEGER NOT NULL,
    "healthBand" "HealthBand" NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "healthScoreId" TEXT NOT NULL,
    "criterion" "HealthIssueCriterion" NOT NULL,
    "severity" "HealthIssueSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE INDEX "User_organizationId_status_idx" ON "User"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_entraObjectId_key" ON "User"("entraObjectId");

-- CreateIndex
CREATE INDEX "MicrosoftTenant_organizationId_status_idx" ON "MicrosoftTenant"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MicrosoftTenant_organizationId_entraTenantId_key" ON "MicrosoftTenant"("organizationId", "entraTenantId");

-- CreateIndex
CREATE INDEX "SharePointSite_organizationId_idx" ON "SharePointSite"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SharePointSite_microsoftTenantId_graphSiteId_key" ON "SharePointSite"("microsoftTenantId", "graphSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_currentHealthScoreId_key" ON "Document"("currentHealthScoreId");

-- CreateIndex
CREATE INDEX "Document_organizationId_status_idx" ON "Document"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Document_siteId_status_idx" ON "Document"("siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Document_siteId_graphItemId_key" ON "Document"("siteId", "graphItemId");

-- CreateIndex
CREATE INDEX "DocumentOwner_documentId_idx" ON "DocumentOwner"("documentId");

-- CreateIndex
CREATE INDEX "DocumentOwner_organizationId_idx" ON "DocumentOwner"("organizationId");

-- CreateIndex
CREATE INDEX "ScanJob_organizationId_status_idx" ON "ScanJob"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ScanJob_microsoftTenantId_status_idx" ON "ScanJob"("microsoftTenantId", "status");

-- CreateIndex
CREATE INDEX "ScanJob_organizationId_createdAt_idx" ON "ScanJob"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "HealthScore_organizationId_documentId_calculatedAt_idx" ON "HealthScore"("organizationId", "documentId", "calculatedAt");

-- CreateIndex
CREATE INDEX "HealthScore_scanJobId_idx" ON "HealthScore"("scanJobId");

-- CreateIndex
CREATE INDEX "HealthIssue_healthScoreId_idx" ON "HealthIssue"("healthScoreId");

-- CreateIndex
CREATE INDEX "HealthIssue_organizationId_criterion_idx" ON "HealthIssue"("organizationId", "criterion");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MicrosoftTenant" ADD CONSTRAINT "MicrosoftTenant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MicrosoftTenant" ADD CONSTRAINT "MicrosoftTenant_consentGrantedByUserId_fkey" FOREIGN KEY ("consentGrantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharePointSite" ADD CONSTRAINT "SharePointSite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharePointSite" ADD CONSTRAINT "SharePointSite_microsoftTenantId_fkey" FOREIGN KEY ("microsoftTenantId") REFERENCES "MicrosoftTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "SharePointSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentHealthScoreId_fkey" FOREIGN KEY ("currentHealthScoreId") REFERENCES "HealthScore"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentOwner" ADD CONSTRAINT "DocumentOwner_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentOwner" ADD CONSTRAINT "DocumentOwner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_microsoftTenantId_fkey" FOREIGN KEY ("microsoftTenantId") REFERENCES "MicrosoftTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthScore" ADD CONSTRAINT "HealthScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthScore" ADD CONSTRAINT "HealthScore_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthScore" ADD CONSTRAINT "HealthScore_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthIssue" ADD CONSTRAINT "HealthIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthIssue" ADD CONSTRAINT "HealthIssue_healthScoreId_fkey" FOREIGN KEY ("healthScoreId") REFERENCES "HealthScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
