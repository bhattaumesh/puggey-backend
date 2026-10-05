-- AlterTable
ALTER TABLE "tenant_memberships" ADD COLUMN     "exitRecordedByName" TEXT,
ADD COLUMN     "exitRemarks" TEXT,
ADD COLUMN     "exitType" TEXT,
ADD COLUMN     "lastWorkingDay" DATE;
