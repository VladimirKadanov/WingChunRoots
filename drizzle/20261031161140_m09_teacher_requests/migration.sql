-- Generated migration (M09: teacher requests and independent approvals):
-- - relationship_event.idempotency_key: the key a client sends with each relationship change
--   (plan §5.6: a double click never records two approvals). One event per (account, key); a second
--   call with the same key finds it and changes nothing.
-- - teaching_relationship.prefers_display_primary: the student's display preference sent with the
--   request (DEFAULT D05, visual only), applied to is_display_primary when the teacher approves.
-- - training_period.school_id: the school of a training period, when the student names one.
-- No new table, so no new grant: app_rw already has SELECT and INSERT on relationship_event and
-- SELECT, INSERT, UPDATE and DELETE on teaching_relationship and training_period.
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
ALTER TABLE "relationship_event" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "teaching_relationship" ADD COLUMN "prefers_display_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "training_period" ADD COLUMN "school_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_event_idempotency_key" ON "relationship_event" ("actor_user_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "training_period_school_id_idx" ON "training_period" ("school_id");--> statement-breakpoint
ALTER TABLE "training_period" ADD CONSTRAINT "training_period_school_id_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "relationship_event" ADD CONSTRAINT "relationship_event_idempotency_key_format" CHECK ("idempotency_key" IS NULL OR "idempotency_key" ~ '^[A-Za-z0-9_-]{8,64}$');