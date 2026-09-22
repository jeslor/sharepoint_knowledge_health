-- CreateEnum
CREATE TYPE "OrganizationPlanType" AS ENUM ('Trial', 'Standard');

-- CreateTable
CREATE TABLE "OrganizationEntitlement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planType" "OrganizationPlanType" NOT NULL DEFAULT 'Trial',
    "documentLimit" INTEGER NOT NULL DEFAULT 2000,
    "currentDocumentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationEntitlement_organizationId_key" ON "OrganizationEntitlement"("organizationId");

-- AddForeignKey
ALTER TABLE "OrganizationEntitlement" ADD CONSTRAINT "OrganizationEntitlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
