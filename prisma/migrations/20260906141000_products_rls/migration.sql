-- Missed in the previous migration: every other tenant-scoped table enforces
-- isolation via RLS (the app queries don't filter by tenantId themselves --
-- see VendorsService for the pattern this mirrors), so products was
-- readable/writable across tenant boundaries until this closes it.
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_tenant_scoped ON "products"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );
