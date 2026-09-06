-- Renamed plan tiers: trial/starter/growth/enterprise -> trial/basic/silver/gold/platinum
-- (see src/plans/plan-tiers.ts). Existing tenants are remapped to the tier
-- that preserves or increases their employee limit, never decreases it.
UPDATE "tenants" SET "plan" = 'silver' WHERE "plan" = 'starter';
UPDATE "tenants" SET "plan" = 'gold' WHERE "plan" = 'growth';
UPDATE "tenants" SET "plan" = 'platinum' WHERE "plan" = 'enterprise';
