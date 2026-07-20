-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('NotStarted', 'Queued', 'Running', 'Completed', 'Failed');

-- AlterTable
ALTER TABLE "MicrosoftTenant" ADD COLUMN     "discoveryCompletedAt" TIMESTAMP(3),
ADD COLUMN     "discoveryError" TEXT,
ADD COLUMN     "discoveryStartedAt" TIMESTAMP(3),
ADD COLUMN     "discoveryStatus" "DiscoveryStatus" NOT NULL DEFAULT 'NotStarted';
