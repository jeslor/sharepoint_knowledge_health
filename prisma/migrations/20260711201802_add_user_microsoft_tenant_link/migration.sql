-- AlterTable
ALTER TABLE "User" ADD COLUMN "microsoftTenantId" TEXT NOT NULL;

-- DropIndex
DROP INDEX "User_entraObjectId_key";

-- CreateIndex
CREATE UNIQUE INDEX "User_microsoftTenantId_entraObjectId_key" ON "User"("microsoftTenantId", "entraObjectId");

-- CreateIndex
CREATE INDEX "MicrosoftTenant_entraTenantId_idx" ON "MicrosoftTenant"("entraTenantId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_microsoftTenantId_fkey" FOREIGN KEY ("microsoftTenantId") REFERENCES "MicrosoftTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
