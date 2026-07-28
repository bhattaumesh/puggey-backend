ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY password_reset_token_owner_scoped ON "password_reset_tokens"
  USING (
    current_setting('app.is_pugey_staff', true) = 'true'
    OR "userId"::text = current_setting('app.current_user_id', true)
  );
