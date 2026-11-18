CREATE TABLE "passport_rank_photo" (
	"rank_id" uuid,
	"photo_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passport_rank_photo_pkey" PRIMARY KEY("rank_id","photo_id"),
	CONSTRAINT "passport_rank_photo_position_check" CHECK ("position" BETWEEN 0 AND 2)
);
--> statement-breakpoint
DROP INDEX "event_attendance_active_key";--> statement-breakpoint
ALTER TABLE "event_attendance" ADD COLUMN "claimed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD COLUMN "decided_by_user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "event_attendance_open_key" ON "event_attendance" ("event_id","person_id") WHERE "status" IN ('active', 'pending', 'refused');--> statement-breakpoint
CREATE INDEX "event_attendance_event_pending_idx" ON "event_attendance" ("event_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "event_attendance_decided_by_user_id_idx" ON "event_attendance" ("decided_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passport_rank_photo_rank_position_key" ON "passport_rank_photo" ("rank_id","position");--> statement-breakpoint
CREATE INDEX "passport_rank_photo_photo_id_idx" ON "passport_rank_photo" ("photo_id");--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_decided_by_user_id_auth_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_rank_photo" ADD CONSTRAINT "passport_rank_photo_rank_id_passport_rank_id_fkey" FOREIGN KEY ("rank_id") REFERENCES "passport_rank"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "passport_rank_photo" ADD CONSTRAINT "passport_rank_photo_photo_id_person_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "person_photo"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_claim_status" CHECK ("claimed" OR "status" NOT IN ('pending', 'refused'));--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_pending_undecided" CHECK ("status" <> 'pending' OR "decided_at" IS NULL);--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_refused_decided" CHECK ("status" <> 'refused' OR "decided_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "event_attendance" DROP CONSTRAINT "event_attendance_status_check", ADD CONSTRAINT "event_attendance_status_check" CHECK ("status" IN ('active', 'withdrawn', 'removed', 'pending', 'refused'));--> statement-breakpoint
-- ADR 0046: the student replaces the photos of a rank (DELETE, then INSERT); app_public_ro reads none of the passport tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "passport_rank_photo" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "passport_rank_photo" FROM app_public_ro;
