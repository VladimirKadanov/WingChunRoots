CREATE TABLE "person_follow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"follower_user_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "person_follow_follower_person_key" ON "person_follow" ("follower_user_id","person_id");--> statement-breakpoint
CREATE INDEX "person_follow_person_idx" ON "person_follow" ("person_id");--> statement-breakpoint
ALTER TABLE "person_follow" ADD CONSTRAINT "person_follow_follower_user_id_auth_user_id_fkey" FOREIGN KEY ("follower_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "person_follow" ADD CONSTRAINT "person_follow_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification_preference" DROP CONSTRAINT "notification_preference_category_check", ADD CONSTRAINT "notification_preference_category_check" CHECK ("category" IN ('security', 'account', 'plan', 'teaching', 'review', 'schools', 'organizations', 'events', 'billing', 'family'));--> statement-breakpoint
-- ADR 0048: the private follows of the kung fu family. The app reads and writes them; the public role never.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "person_follow" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "person_follow" FROM app_public_ro;
