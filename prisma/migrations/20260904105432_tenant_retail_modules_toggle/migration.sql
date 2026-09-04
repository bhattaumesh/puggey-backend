-- Racks/vendors/product-received are retail-store-specific, not universal --
-- a per-tenant toggle so an org that isn't a shop (a school, a service
-- business) can hide that module instead of seeing quick actions that don't
-- apply to them. Defaults true so every existing tenant's behavior is
-- unchanged until they turn it off themselves in Settings.
ALTER TABLE "tenants" ADD COLUMN "retailModulesEnabled" BOOLEAN NOT NULL DEFAULT true;
