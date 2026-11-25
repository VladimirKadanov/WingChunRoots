-- ADR 0062 (docs/adr/0062-event-how-to-join.md; role replay 2026-11-25, P2-9): how to join an
-- event. event gains price_note, open_to, registration_url and registration_email, each optional
-- and public (the organizer publishes them), and v_public_event gains them as its last columns
-- (CREATE OR REPLACE VIEW appends them; the view keeps its grants and its security_barrier).
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
ALTER TABLE "event" ADD COLUMN "price_note" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "open_to" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "registration_url" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "registration_email" text;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_price_note_length" CHECK ("price_note" IS NULL OR char_length("price_note") BETWEEN 1 AND 120);--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_open_to_check" CHECK ("open_to" IS NULL OR "open_to" IN ('all_levels', 'members_only', 'instructors_only'));--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_registration_url_https" CHECK ("registration_url" IS NULL OR ("registration_url" ~ '^https://[^[:space:]]+$' AND char_length("registration_url") <= 600));--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_registration_email_format" CHECK ("registration_email" IS NULL OR ("registration_email" ~ '^[^[:space:]@]+@[^[:space:]@]+$' AND char_length("registration_email") <= 254));--> statement-breakpoint
CREATE OR REPLACE VIEW "v_public_event" WITH (security_barrier = true) AS
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
  e."updated_at",
  e."price_note",
  e."open_to",
  e."registration_url",
  e."registration_email"
FROM "event" e
LEFT JOIN "place" pl ON pl."id" = e."place_id"
LEFT JOIN "v_public_person" op ON op."id" = e."organizer_person_id"
LEFT JOIN "v_public_organization" o ON o."id" = e."organization_id"
LEFT JOIN "v_public_school" s ON s."id" = e."school_id"
WHERE e."status" IN ('published', 'cancelled')
  AND (e."organization_id" IS NULL OR o."id" IS NOT NULL);
