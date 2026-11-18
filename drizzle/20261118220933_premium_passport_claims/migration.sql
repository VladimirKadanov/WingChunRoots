DROP INDEX "event_attendance_active_key";--> statement-breakpoint
ALTER TABLE "event_attendance" ADD COLUMN "claimed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD COLUMN "decided_by_user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "event_attendance_open_key" ON "event_attendance" ("event_id","person_id") WHERE "status" IN ('active', 'pending', 'refused');--> statement-breakpoint
CREATE INDEX "event_attendance_event_pending_idx" ON "event_attendance" ("event_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "event_attendance_decided_by_user_id_idx" ON "event_attendance" ("decided_by_user_id");--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_decided_by_user_id_auth_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_claim_status" CHECK ("claimed" OR "status" NOT IN ('pending', 'refused'));--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_pending_undecided" CHECK ("status" <> 'pending' OR "decided_at" IS NULL);--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_refused_decided" CHECK ("status" <> 'refused' OR "decided_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "event_attendance" DROP CONSTRAINT "event_attendance_status_check", ADD CONSTRAINT "event_attendance_status_check" CHECK ("status" IN ('active', 'withdrawn', 'removed', 'pending', 'refused'));