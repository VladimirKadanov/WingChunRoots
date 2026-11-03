-- Generated migration with custom SQL (M16: galleries; docs/adr/0019-galleries.md):
-- - person_photo: the gallery of a person. The profile photo stays the one `active` photo (M14's
--   person_photo_one_active_key and v_public_person are unchanged); the gallery's other photos have
--   the new status `gallery`. A caption, the order in the gallery and the size of the `full`
--   rendition (the whole photo for the viewer; null for a photo of M14).
-- - school_photo: a school's logo (at most one active) and its room photos, apart from every
--   person's gallery and allowance.
-- app_public_ro has no right on either table; the public pages read them as app_rw, only for a
-- person v_public_person shows and a school v_public_school shows (app_public_ro keeps its three
-- views). Evidence is never in these tables (DEFAULT D13).
-- SQL compatible with PostgreSQL 16+ (plan §3.2); ids come from the app (UUIDv7).
CREATE TABLE "school_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"school_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"original_sha256" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"full_width" integer,
	"full_height" integer,
	"size_bytes" integer NOT NULL,
	"caption" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"uploaded_by_user_id" uuid,
	"removed_by_user_id" uuid,
	"removed_at" timestamp with time zone,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_photo_kind_check" CHECK ("kind" IN ('logo', 'room')),
	CONSTRAINT "school_photo_status_check" CHECK ("status" IN ('active', 'replaced', 'removed')),
	CONSTRAINT "school_photo_storage_key_format" CHECK ("storage_key" ~ '^photos/[0-9a-f]{48}$'),
	CONSTRAINT "school_photo_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "school_photo_original_sha256_format" CHECK ("original_sha256" IS NULL OR "original_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "school_photo_square" CHECK ("width" = "height" AND "width" BETWEEN 96 AND 512),
	CONSTRAINT "school_photo_full_size" CHECK (("full_width" IS NULL AND "full_height" IS NULL) OR ("full_width" BETWEEN 1 AND 1280 AND "full_height" BETWEEN 1 AND 1280)),
	CONSTRAINT "school_photo_size_check" CHECK ("size_bytes" > 0),
	CONSTRAINT "school_photo_caption_length" CHECK ("caption" IS NULL OR char_length("caption") BETWEEN 1 AND 200),
	CONSTRAINT "school_photo_removed_has_time" CHECK ("status" <> 'removed' OR "removed_at" IS NOT NULL),
	CONSTRAINT "school_photo_reason_length" CHECK ("removal_reason" IS NULL OR char_length("removal_reason") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "person_photo" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "person_photo" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "person_photo" ADD COLUMN "full_width" integer;--> statement-breakpoint
ALTER TABLE "person_photo" ADD COLUMN "full_height" integer;--> statement-breakpoint
CREATE INDEX "person_photo_gallery_idx" ON "person_photo" ("person_id","position") WHERE "status" IN ('active', 'gallery');--> statement-breakpoint
CREATE UNIQUE INDEX "school_photo_storage_key_key" ON "school_photo" ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "school_photo_one_logo_key" ON "school_photo" ("school_id") WHERE "kind" = 'logo' AND "status" = 'active';--> statement-breakpoint
CREATE INDEX "school_photo_school_idx" ON "school_photo" ("school_id","kind","position") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "school_photo_uploaded_by_user_id_idx" ON "school_photo" ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "school_photo_removed_by_user_id_idx" ON "school_photo" ("removed_by_user_id");--> statement-breakpoint
ALTER TABLE "school_photo" ADD CONSTRAINT "school_photo_school_id_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "school_photo" ADD CONSTRAINT "school_photo_uploaded_by_user_id_auth_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "school_photo" ADD CONSTRAINT "school_photo_removed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "person_photo" ADD CONSTRAINT "person_photo_caption_length" CHECK ("caption" IS NULL OR char_length("caption") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "person_photo" ADD CONSTRAINT "person_photo_full_size" CHECK (("full_width" IS NULL AND "full_height" IS NULL) OR ("full_width" BETWEEN 1 AND 1280 AND "full_height" BETWEEN 1 AND 1280));--> statement-breakpoint
ALTER TABLE "person_photo" DROP CONSTRAINT "person_photo_status_check", ADD CONSTRAINT "person_photo_status_check" CHECK ("status" IN ('active', 'replaced', 'removed', 'gallery'));--> statement-breakpoint
REVOKE ALL ON TABLE "school_photo" FROM app_public_ro;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "school_photo" TO app_rw;
