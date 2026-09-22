-- CreateEnum
CREATE TYPE "UpgradeRequestStatus" AS ENUM ('Pending', 'Contacted', 'Completed');

-- CreateTable
CREATE TABLE "UpgradeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "message" TEXT,
    "status" "UpgradeRequestStatus" NOT NULL DEFAULT 'Pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpgradeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpgradeRequest_organizationId_createdAt_idx" ON "UpgradeRequest"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "UpgradeRequest_requestedByUserId_createdAt_idx" ON "UpgradeRequest"("requestedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "UpgradeRequest" ADD CONSTRAINT "UpgradeRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpgradeRequest" ADD CONSTRAINT "UpgradeRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
