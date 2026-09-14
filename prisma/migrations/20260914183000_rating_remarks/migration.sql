-- A rater's own text comment, alongside the existing numeric rating.
ALTER TABLE "rack_cleaning_logs" ADD COLUMN "ratingRemarks" TEXT;
ALTER TABLE "counter_sessions" ADD COLUMN "verificationRemarks" TEXT;
