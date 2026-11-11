-- Generated migration with custom SQL (M21: schedule, fees, trial lessons and school stats;
-- docs/adr/0024-trial-lessons.md; DEFAULT M21, docs/plan/questions/M21.md):
-- - school.fees_text, school.first_trial_free and school_schedule_slot: the weekly schedule (in the
--   school's own zone) and the fees of a listed school; plain listing content, no plan gate.
-- - trial_inquiry: a signed-in adult's request for a trial lesson at a public school, with the
--   sender's name and chosen contact detail copied in; one open inquiry per sender and school. Only
--   the services read it (app_rw); no public view names it.
-- - school_stat_day: counts per school and UTC day only (no IP, account, cookie or fingerprint).
-- app_rw may delete in the three tables (the schedule is replaced; the daily retention deletes
-- closed inquiries after 365 days and counters after 400). app_public_ro reads none of them.
-- No change to v_public_school. SQL compatible with PostgreSQL 16+ (plan §3.2); ids come from the
-- app (UUIDv7).
CREATE TABLE "school_schedule_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"school_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"label" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_schedule_slot_weekday_check" CHECK ("weekday" BETWEEN 1 AND 7),
	CONSTRAINT "school_schedule_slot_times" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "school_schedule_slot_label_length" CHECK ("label" IS NULL OR char_length("label") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "school_stat_day" (
	"school_id" uuid,
	"day" date,
	"page_views" integer DEFAULT 0 NOT NULL,
	"pin_opens" integer DEFAULT 0 NOT NULL,
	"contact_clicks" integer DEFAULT 0 NOT NULL,
	"trial_inquiries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_stat_day_pkey" PRIMARY KEY("school_id","day"),
	CONSTRAINT "school_stat_day_counts" CHECK ("page_views" >= 0 AND "pin_opens" >= 0 AND "contact_clicks" >= 0 AND "trial_inquiries" >= 0)
);
--> statement-breakpoint
CREATE TABLE "trial_inquiry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"school_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"sender_name" text NOT NULL,
	"contact_method" text NOT NULL,
	"contact_value" text NOT NULL,
	"preferred_times" text,
	"message" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reply" text,
	"handled_by_user_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trial_inquiry_status_check" CHECK ("status" IN ('open', 'answered', 'declined', 'closed')),
	CONSTRAINT "trial_inquiry_contact_method_check" CHECK ("contact_method" IN ('email', 'phone')),
	CONSTRAINT "trial_inquiry_closed_has_time" CHECK (("status" = 'open') = ("closed_at" IS NULL)),
	CONSTRAINT "trial_inquiry_sender_name_length" CHECK (char_length("sender_name") BETWEEN 1 AND 200),
	CONSTRAINT "trial_inquiry_contact_value_length" CHECK (char_length("contact_value") BETWEEN 3 AND 254),
	CONSTRAINT "trial_inquiry_preferred_length" CHECK ("preferred_times" IS NULL OR char_length("preferred_times") BETWEEN 1 AND 200),
	CONSTRAINT "trial_inquiry_message_length" CHECK ("message" IS NULL OR char_length("message") BETWEEN 1 AND 1000),
	CONSTRAINT "trial_inquiry_reply_length" CHECK ("reply" IS NULL OR char_length("reply") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "fees_text" text;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "first_trial_free" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "school_schedule_slot_school_idx" ON "school_schedule_slot" ("school_id","weekday","starts_at");--> statement-breakpoint
CREATE INDEX "school_stat_day_day_idx" ON "school_stat_day" ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_inquiry_one_open_key" ON "trial_inquiry" ("school_id","sender_user_id") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "trial_inquiry_sender_idx" ON "trial_inquiry" ("sender_user_id","created_at");--> statement-breakpoint
CREATE INDEX "trial_inquiry_school_idx" ON "trial_inquiry" ("school_id","status","created_at");--> statement-breakpoint
CREATE INDEX "trial_inquiry_closed_at_idx" ON "trial_inquiry" ("closed_at") WHERE "closed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "trial_inquiry_handled_by_user_id_idx" ON "trial_inquiry" ("handled_by_user_id");--> statement-breakpoint
ALTER TABLE "school_schedule_slot" ADD CONSTRAINT "school_schedule_slot_school_id_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "school_stat_day" ADD CONSTRAINT "school_stat_day_school_id_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trial_inquiry" ADD CONSTRAINT "trial_inquiry_school_id_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trial_inquiry" ADD CONSTRAINT "trial_inquiry_sender_user_id_auth_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "trial_inquiry" ADD CONSTRAINT "trial_inquiry_handled_by_user_id_auth_user_id_fkey" FOREIGN KEY ("handled_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_fees_text_length" CHECK ("fees_text" IS NULL OR char_length("fees_text") BETWEEN 1 AND 500);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "school_schedule_slot", "trial_inquiry", "school_stat_day" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "school_schedule_slot", "trial_inquiry", "school_stat_day" FROM app_public_ro;
