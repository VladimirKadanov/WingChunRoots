-- Generated migration with custom SQL (M17: the event calendar; docs/adr/0020-events.md):
-- - event: a seminar, camp, exam session or other event, organized by a Sifu's account (with its
--   person) or by an organization; its instant range and its own IANA zone; a city or online; an
--   optional venue line the organizer publishes and an optional school; an https link; the status
--   (published, cancelled, removed) with who and why; the poster (key, hash, size).
-- - event_instructor: up to 5 people of the archive, in order.
-- - notification_event_once_key: one notice per person, event and change (DEFAULT M17, question 3).
-- - v_public_event: the public fields of published and cancelled events, with the organizer and the
--   instructors only while they are public people (v_public_person) or an approved organization,
--   a school only while it is public, by name and city; never a point, an account, a reason of
--   staff or a storage key. app_public_ro reads this view only, never the tables.
-- SQL compatible with PostgreSQL 16+ (plan §3.2); ids come from the app (UUIDv7).
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"place_id" uuid,
	"venue" text,
	"school_id" uuid,
	"external_url" text,
	"organizer_user_id" uuid,
	"organizer_person_id" uuid,
	"organization_id" uuid,
	"created_by_user_id" uuid,
	"status" text DEFAULT 'published' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancellation_note" text,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid,
	"removal_reason" text,
	"poster_storage_key" text,
	"poster_sha256" text,
	"poster_width" integer,
	"poster_height" integer,
	"poster_size_bytes" integer,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "event_kind_check" CHECK ("kind" IN ('seminar', 'camp', 'exam_session', 'other')),
	CONSTRAINT "event_status_check" CHECK ("status" IN ('published', 'cancelled', 'removed')),
	CONSTRAINT "event_title_length" CHECK (char_length("title") BETWEEN 2 AND 160),
	CONSTRAINT "event_description_length" CHECK ("description" IS NULL OR char_length("description") BETWEEN 1 AND 4000),
	CONSTRAINT "event_venue_length" CHECK ("venue" IS NULL OR char_length("venue") BETWEEN 1 AND 200),
	CONSTRAINT "event_ends_after_start" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "event_timezone_format" CHECK ("timezone" ~ '^[A-Za-z][A-Za-z0-9_+/-]{1,80}$'),
	CONSTRAINT "event_place_or_online" CHECK (("online" AND "place_id" IS NULL AND "venue" IS NULL) OR (NOT "online" AND "place_id" IS NOT NULL)),
	CONSTRAINT "event_external_url_https" CHECK ("external_url" IS NULL OR ("external_url" ~ '^https://[^[:space:]]+$' AND char_length("external_url") <= 600)),
	CONSTRAINT "event_one_organizer" CHECK (("organization_id" IS NULL AND "organizer_person_id" IS NOT NULL) OR ("organization_id" IS NOT NULL AND "organizer_person_id" IS NULL AND "organizer_user_id" IS NULL)),
	CONSTRAINT "event_cancelled_has_time" CHECK ("status" <> 'cancelled' OR "cancelled_at" IS NOT NULL),
	CONSTRAINT "event_removed_has_time" CHECK ("status" <> 'removed' OR "removed_at" IS NOT NULL),
	CONSTRAINT "event_cancellation_note_length" CHECK ("cancellation_note" IS NULL OR char_length("cancellation_note") BETWEEN 1 AND 1000),
	CONSTRAINT "event_removal_reason_length" CHECK ("removal_reason" IS NULL OR char_length("removal_reason") BETWEEN 1 AND 1000),
	CONSTRAINT "event_poster_complete" CHECK (("poster_storage_key" IS NULL AND "poster_sha256" IS NULL AND "poster_width" IS NULL AND "poster_height" IS NULL AND "poster_size_bytes" IS NULL) OR ("poster_storage_key" ~ '^photos/[0-9a-f]{48}$' AND "poster_sha256" ~ '^[0-9a-f]{64}$' AND "poster_width" BETWEEN 1 AND 1280 AND "poster_height" BETWEEN 1 AND 1280 AND "poster_size_bytes" > 0)),
	CONSTRAINT "event_revision_check" CHECK ("revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "event_instructor" (
	"event_id" uuid,
	"person_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_instructor_pkey" PRIMARY KEY("event_id","person_id"),
	CONSTRAINT "event_instructor_position_check" CHECK ("position" BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "event_slug_key" ON "event" ("slug");--> statement-breakpoint
CREATE INDEX "event_starts_at_idx" ON "event" ("starts_at") WHERE "status" IN ('published', 'cancelled');--> statement-breakpoint
CREATE INDEX "event_organizer_user_id_idx" ON "event" ("organizer_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_organizer_person_id_idx" ON "event" ("organizer_person_id");--> statement-breakpoint
CREATE INDEX "event_organization_id_idx" ON "event" ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_place_id_idx" ON "event" ("place_id");--> statement-breakpoint
CREATE INDEX "event_school_id_idx" ON "event" ("school_id");--> statement-breakpoint
CREATE INDEX "event_created_by_user_id_idx" ON "event" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "event_cancelled_by_user_id_idx" ON "event" ("cancelled_by_user_id");--> statement-breakpoint
CREATE INDEX "event_removed_by_user_id_idx" ON "event" ("removed_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_poster_storage_key_key" ON "event" ("poster_storage_key");--> statement-breakpoint
CREATE INDEX "event_instructor_person_id_idx" ON "event_instructor" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_once_key" ON "notification" ("user_id","template",("payload" ->> 'eventId')) WHERE "template" IN ('event.published', 'event.cancelled');--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_place_id_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "place"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_school_id_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_organizer_user_id_auth_user_id_fkey" FOREIGN KEY ("organizer_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_organizer_person_id_person_id_fkey" FOREIGN KEY ("organizer_person_id") REFERENCES "person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_cancelled_by_user_id_auth_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_removed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event_instructor" ADD CONSTRAINT "event_instructor_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_instructor" ADD CONSTRAINT "event_instructor_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "event" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "event_instructor" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "event", "event_instructor" FROM app_public_ro;--> statement-breakpoint
CREATE VIEW "v_public_event" WITH (security_barrier = true) AS
SELECT
  e."id",
  e."slug",
  e."title",
  e."kind",
  e."description",
  e."starts_at",
  e."ends_at",
  e."timezone",
  e."online",
  e."venue",
  e."place_id",
  pl."name" AS "city_name",
  pl."country_code",
  e."external_url",
  e."status",
  e."cancelled_at",
  e."cancellation_note",
  op."id" AS "organizer_person_id",
  op."slug" AS "organizer_person_slug",
  op."display_name" AS "organizer_person_name",
  (SELECT n."lang" FROM "person_name" n WHERE n."person_id" = op."id" AND n."is_primary" LIMIT 1) AS "organizer_person_lang",
  o."id" AS "organization_id",
  o."slug" AS "organization_slug",
  o."name" AS "organization_name",
  s."id" AS "school_id",
  s."slug" AS "school_slug",
  s."name" AS "school_name",
  s."city_name" AS "school_city",
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', p."id", 'slug', p."slug", 'display_name', p."display_name",
             'lang', (SELECT n."lang" FROM "person_name" n WHERE n."person_id" = p."id" AND n."is_primary" LIMIT 1)) ORDER BY ei."position", p."display_name", p."id")
      FROM "event_instructor" ei
      JOIN "v_public_person" p ON p."id" = ei."person_id"
     WHERE ei."event_id" = e."id"
  ), '[]'::jsonb) AS "instructors",
  e."poster_sha256",
  e."poster_width",
  e."poster_height",
  e."revision",
  e."created_at",
  e."updated_at"
FROM "event" e
LEFT JOIN "place" pl ON pl."id" = e."place_id"
LEFT JOIN "v_public_person" op ON op."id" = e."organizer_person_id"
LEFT JOIN "v_public_organization" o ON o."id" = e."organization_id"
LEFT JOIN "v_public_school" s ON s."id" = e."school_id"
WHERE e."status" IN ('published', 'cancelled')
  AND (e."organization_id" IS NULL OR o."id" IS NOT NULL);--> statement-breakpoint
GRANT SELECT ON TABLE "v_public_event" TO app_rw, app_public_ro;
