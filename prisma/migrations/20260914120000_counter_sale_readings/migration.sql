-- Running sales-counter readings taken at open and close of a counter
-- session, so total sales for the shift can be computed as the difference
-- (closingSale - previousSale) instead of relying only on ad-hoc "sales"
-- cash movements. Nullable: existing/open sessions predate this column.
ALTER TABLE "counter_sessions" ADD COLUMN "previousSale" DECIMAL(12,2);
ALTER TABLE "counter_sessions" ADD COLUMN "closingSale" DECIMAL(12,2);
