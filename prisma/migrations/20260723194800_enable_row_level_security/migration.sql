-- Row-level security: tenant isolation enforced by Postgres itself, driven by two
-- per-request session variables the app sets via SET LOCAL at the start of every
-- transaction:
--   app.tenant_id       -- uuid text of the caller's active tenant, '' if none
--   app.is_pugey_staff  -- 'true' for platform-staff sessions, else 'false'
--
-- IMPORTANT: this only actually restricts access for a non-superuser, non-owner
-- role. The app must connect as APP_DATABASE_URL (role: pugey_app), never as the
-- migration/superuser role, or these policies are silently bypassed.

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self_or_staff ON "tenants"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR id::text = current_setting('app.tenant_id', true)
  );

ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_tenant_scoped ON "tenant_memberships"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_tenant_scoped ON "audit_logs"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "tenantId"::text = current_setting('app.tenant_id', true)
  );

-- users is a global identity table (one person can belong to several tenants), so
-- its policy is "visible if you have a membership in the caller's active tenant."
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY user_visible_via_membership ON "users"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR EXISTS (
      SELECT 1 FROM "tenant_memberships" m
      WHERE m."userId" = "users".id
        AND m."tenantId"::text = current_setting('app.tenant_id', true)
    )
    -- a user can always see their own row, even before a tenant is selected
    -- (needed during the email->tenant resolution step of login)
    OR id::text = current_setting('app.current_user_id', true)
  );

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY refresh_token_owner_scoped ON "refresh_tokens"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "userId"::text = current_setting('app.current_user_id', true)
  );

-- Pugey staff table is never visible in a tenant context, full stop.
ALTER TABLE "pugey_staff_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pugey_staff_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY pugey_staff_platform_only ON "pugey_staff_members"
  USING (current_setting('app.is_pugey_staff', true) = 'true');
