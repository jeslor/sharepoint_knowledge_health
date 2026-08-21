-- AlterTable
ALTER TABLE "MicrosoftTenant" ADD COLUMN     "verifiedReadPermissionVersion" INTEGER,
ADD COLUMN     "consentAssertedPermissionVersion" INTEGER,
ADD COLUMN     "consentAssertedAt" TIMESTAMP(3);
