-- Generated migration (M02 fix round 1), with the grants added by hand at the end:
-- - auth_throttle: counters and one-time markers of the accounts module (failed sign-ins per
--   address, used TOTP codes); src/server/auth/throttle.ts.
-- - an index on every foreign key to auth_user that had none, so deleting an account (the purge of
--   unconfirmed accounts) and the RESTRICT checks do not scan whole tables.
-- - auth_user: a bounded name and no image (Better Auth's /update-user is off).
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_throttle_key_length" CHECK (char_length("key") <= 200),
	CONSTRAINT "auth_throttle_count_check" CHECK ("count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "auth_throttle_expires_at_idx" ON "auth_throttle" ("expires_at");--> statement-breakpoint
CREATE INDEX "entitlement_grant_granted_by_user_id_idx" ON "entitlement_grant" ("granted_by_user_id");--> statement-breakpoint
CREATE INDEX "entitlement_grant_revoked_by_user_id_idx" ON "entitlement_grant" ("revoked_by_user_id");--> statement-breakpoint
CREATE INDEX "content_report_reporter_user_id_idx" ON "content_report" ("reporter_user_id");--> statement-breakpoint
CREATE INDEX "evidence_file_uploaded_by_user_id_idx" ON "evidence_file" ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "evidence_link_created_by_user_id_idx" ON "evidence_link" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "review_case_opened_by_user_id_idx" ON "review_case" ("opened_by_user_id");--> statement-breakpoint
CREATE INDEX "review_note_author_user_id_idx" ON "review_note" ("author_user_id");--> statement-breakpoint
CREATE INDEX "relationship_event_actor_user_id_idx" ON "relationship_event" ("actor_user_id");--> statement-breakpoint
CREATE INDEX "teaching_relationship_requested_by_user_id_idx" ON "teaching_relationship" ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "teaching_relationship_confirmed_by_user_id_idx" ON "teaching_relationship" ("confirmed_by_user_id");--> statement-breakpoint
CREATE INDEX "invitation_invited_by_user_id_idx" ON "invitation" ("invited_by_user_id");--> statement-breakpoint
CREATE INDEX "person_created_by_user_id_idx" ON "person" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "person_claim_decided_by_user_id_idx" ON "person_claim" ("decided_by_user_id");--> statement-breakpoint
CREATE INDEX "email_delivery_user_id_idx" ON "email_delivery" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "school_created_by_user_id_idx" ON "school" ("created_by_user_id");--> statement-breakpoint
ALTER TABLE "auth_user" ADD CONSTRAINT "auth_user_name_length" CHECK (char_length("name") <= 200);--> statement-breakpoint
ALTER TABLE "auth_user" ADD CONSTRAINT "auth_user_no_image" CHECK ("image" IS NULL);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "auth_throttle" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "auth_throttle" FROM app_public_ro;
