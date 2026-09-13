-- Peer verification for a closed counter session, plus an optional
-- 1-5 work-done rating given at verification time.
ALTER TABLE "counter_sessions" ADD COLUMN "verifiedByMembershipId" TEXT;
ALTER TABLE "counter_sessions" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "counter_sessions" ADD COLUMN "workRating" INTEGER;

ALTER TABLE "counter_sessions" ADD CONSTRAINT "counter_sessions_verifiedByMembershipId_fkey" FOREIGN KEY ("verifiedByMembershipId") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
