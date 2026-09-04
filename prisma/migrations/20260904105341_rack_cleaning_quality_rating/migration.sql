-- AlterTable: a supervisor/admin rates the quality of a completed rack
-- cleaning after the fact -- null until rated, range (1-5) enforced in the
-- DTO rather than a DB constraint, same approach as the payroll percent
-- fields elsewhere in this schema.
ALTER TABLE "rack_cleaning_logs" ADD COLUMN "qualityRating" INTEGER;
ALTER TABLE "rack_cleaning_logs" ADD COLUMN "ratedByMembershipId" TEXT;
ALTER TABLE "rack_cleaning_logs" ADD COLUMN "ratedAt" TIMESTAMP(3);

ALTER TABLE "rack_cleaning_logs" ADD CONSTRAINT "rack_cleaning_logs_ratedByMembershipId_fkey" FOREIGN KEY ("ratedByMembershipId") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
