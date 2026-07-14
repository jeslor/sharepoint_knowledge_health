-- CreateEnum
CREATE TYPE "ScanJobTriggerSource" AS ENUM ('Manual', 'Scheduled');

-- CreateEnum
CREATE TYPE "ScanScheduleFrequency" AS ENUM ('Daily', 'Weekly');

-- AlterTable
ALTER TABLE "ScanJob" ALTER COLUMN "triggeredByUserId" DROP NOT NULL;
ALTER TABLE "ScanJob" ADD COLUMN     "triggerSource" "ScanJobTriggerSource" NOT NULL DEFAULT 'Manual';

-- CreateTable
CREATE TABLE "ScanSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "frequency" "ScanScheduleFrequency" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScanSchedule_organizationId_key" ON "ScanSchedule"("organizationId");

-- CreateIndex
CREATE INDEX "ScanSchedule_enabled_nextRunAt_idx" ON "ScanSchedule"("enabled", "nextRunAt");

-- AddForeignKey
ALTER TABLE "ScanSchedule" ADD CONSTRAINT "ScanSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
