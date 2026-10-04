-- DropIndex
DROP INDEX "counters_tenantId_name_key";

-- AlterTable
ALTER TABLE "counters" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "counters_tenantId_name_idx" ON "counters"("tenantId", "name");
