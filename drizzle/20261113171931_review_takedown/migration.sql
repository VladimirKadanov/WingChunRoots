ALTER TABLE "person" ADD COLUMN "taken_down_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "taken_down_reason" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "taken_down_visibility" text;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_taken_down_hidden" CHECK ("taken_down_at" IS NULL OR "visibility" = 'involved_only');--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_taken_down_complete" CHECK (("taken_down_at" IS NULL AND "taken_down_reason" IS NULL AND "taken_down_visibility" IS NULL)
        OR ("taken_down_at" IS NOT NULL AND "taken_down_visibility" IS NOT NULL AND "taken_down_reason" IS NOT NULL AND btrim("taken_down_reason") <> '' AND length("taken_down_reason") <= 500));--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_taken_down_visibility_check" CHECK ("taken_down_visibility" IN ('involved_only', 'public'));--> statement-breakpoint
-- A suspension ends every session at once, however banned was set (review 2026-11, authz 12):
-- the function is the one of auth_user_end_sessions (role and 2FA changes); this trigger adds the
-- moment an account becomes banned. Requests of a banned account are refused on top of this
-- (src/server/auth/session.ts), so a session created in a race is refused too.
CREATE TRIGGER "auth_user_end_sessions_on_ban" AFTER UPDATE OF "banned" ON "auth_user"
  FOR EACH ROW
  WHEN (NOT OLD."banned" AND NEW."banned")
  EXECUTE FUNCTION "auth_user_end_sessions"();
