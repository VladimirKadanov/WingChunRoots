-- Generated migration with custom SQL (M18: lifecycle notices; docs/adr/0021-notices.md):
-- - notification_preference: the account's choice of e-mail per category of notices (DEFAULT M18,
--   question 1); no row means the catalog's default; security and account are never off; `version`
--   grows with every change, so an unsubscribe link works until the preference changes.
-- - notification.dedupe_key: one notice per account and key (src/server/services/notify.ts).
-- - notification_created_at_idx: the retention job (DEFAULT M18, question 3).
-- app_rw reads and writes the new table; app_public_ro never sees it.
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
CREATE TABLE "notification_preference" (
	"user_id" uuid,
	"category" text,
	"email" boolean NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_pkey" PRIMARY KEY("user_id","category"),
	CONSTRAINT "notification_preference_category_check" CHECK ("category" IN ('security', 'account', 'plan', 'teaching', 'review', 'schools', 'organizations', 'events')),
	CONSTRAINT "notification_preference_locked_categories" CHECK ("email" OR "category" NOT IN ('security', 'account')),
	CONSTRAINT "notification_preference_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_key" ON "notification" ("user_id","dedupe_key") WHERE "dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notification_created_at_idx" ON "notification" ("created_at");--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "notification_preference" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "notification_preference" FROM app_public_ro;
