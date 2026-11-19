CREATE TABLE "person_video" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"provider" text NOT NULL,
	"video_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_video_position_range" CHECK ("position" BETWEEN 0 AND 19),
	CONSTRAINT "person_video_provider_check" CHECK ("provider" IN ('youtube', 'vimeo')),
	CONSTRAINT "person_video_id_format" CHECK (("provider" = 'youtube' AND "video_id" ~ '^[A-Za-z0-9_-]{11}$') OR ("provider" = 'vimeo' AND "video_id" ~ '^[0-9]{6,12}$')),
	CONSTRAINT "person_video_title_length" CHECK (char_length("title") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "person_video_person_position_key" ON "person_video" ("person_id","position");--> statement-breakpoint
ALTER TABLE "person_video" ADD CONSTRAINT "person_video_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
-- ADR 0050: the videos of a profile. The app reads and writes them; the public role never.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "person_video" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "person_video" FROM app_public_ro;
