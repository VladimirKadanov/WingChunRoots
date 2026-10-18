-- Custom SQL migration (M02): privileges on the Better Auth tables and the rule of plan §3.2 that
-- every session of an account ends when its role changes and when it turns on two-factor
-- authentication. The trigger covers every path (Better Auth endpoints, the services, the seed,
-- hand-written SQL), for cookie and bearer sessions alike: both are rows of auth_session.
-- SQL compatible with PostgreSQL 16+ (plan §3.2).

-- 1. Privileges (plan §6.2, §6.4): app_rw reads and writes the auth tables; app_public_ro never
--    sees them (explicit, although it never received them).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "auth_user", "auth_session", "auth_account", "auth_verification", "auth_two_factor"
  TO app_rw;
--> statement-breakpoint
REVOKE ALL ON TABLE
  "auth_user", "auth_session", "auth_account", "auth_verification", "auth_two_factor"
  FROM app_public_ro;
--> statement-breakpoint

-- 2. End every session of an account when its role changes or when two-factor authentication is
--    turned on (plan §3.2). The short-lived verification values of the account go too: password
--    reset tokens, a pending two-factor sign-in and trusted devices all carry the user id as their
--    value. Better Auth creates the new session of the 2FA enable flow after its user update, so
--    that session survives (docs/adr/0004-auth.md).
CREATE FUNCTION "auth_user_end_sessions"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "auth_session" WHERE "user_id" = NEW."id";
  DELETE FROM "auth_verification" WHERE "value" = NEW."id"::text;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "auth_user_end_sessions" AFTER UPDATE OF "role", "two_factor_enabled" ON "auth_user"
  FOR EACH ROW
  WHEN (OLD."role" IS DISTINCT FROM NEW."role" OR (NOT OLD."two_factor_enabled" AND NEW."two_factor_enabled"))
  EXECUTE FUNCTION "auth_user_end_sessions"();
