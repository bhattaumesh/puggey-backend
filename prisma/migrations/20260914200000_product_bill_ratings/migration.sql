-- Same rating shape as rack_cleaning_logs: a supervisor/admin's own score
-- and remark, never set by whoever logged the receipt or entered the bill.
ALTER TABLE "product_received_logs" ADD COLUMN "qualityRating" INTEGER;
ALTER TABLE "product_received_logs" ADD COLUMN "ratingRemarks" TEXT;
ALTER TABLE "product_received_logs" ADD COLUMN "ratedByMembershipId" TEXT;
ALTER TABLE "product_received_logs" ADD COLUMN "ratedAt" TIMESTAMP(3);
ALTER TABLE "product_received_logs" ADD CONSTRAINT "product_received_logs_ratedByMembershipId_fkey" FOREIGN KEY ("ratedByMembershipId") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bills" ADD COLUMN "qualityRating" INTEGER;
ALTER TABLE "bills" ADD COLUMN "ratingRemarks" TEXT;
ALTER TABLE "bills" ADD COLUMN "ratedByMembershipId" TEXT;
ALTER TABLE "bills" ADD COLUMN "ratedAt" TIMESTAMP(3);
ALTER TABLE "bills" ADD CONSTRAINT "bills_ratedByMembershipId_fkey" FOREIGN KEY ("ratedByMembershipId") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
