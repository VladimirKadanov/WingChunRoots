-- Generated migration with custom SQL (M14: profile photos; docs/adr/0016-profile-photos.md):
-- - person_photo: one row per uploaded profile photo (its random storage key, the content hash of
--   the stored rendition, the hash of the original, the square side, the uploader and, once
--   removed, who removed it and why); at most one active photo per person.
-- - person.photo_id: the current photo, or none.
-- - v_public_person.photo_id and photo_sha256: the current photo of a public person, only while
--   it is active, appended at the end (CREATE OR REPLACE VIEW keeps the existing columns and
--   their order; the filters are unchanged, DEFAULT D03). app_public_ro still reads only its three
--   views, never person_photo, and never a storage key.
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
CREATE TABLE "person_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"original_sha256" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"uploaded_by_user_id" uuid,
	"removed_by_user_id" uuid,
	"removed_at" timestamp with time zone,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_photo_status_check" CHECK ("status" IN ('active', 'replaced', 'removed')),
	CONSTRAINT "person_photo_storage_key_format" CHECK ("storage_key" ~ '^photos/[0-9a-f]{48}$'),
	CONSTRAINT "person_photo_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "person_photo_original_sha256_format" CHECK ("original_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "person_photo_square" CHECK ("width" = "height" AND "width" BETWEEN 96 AND 512),
	CONSTRAINT "person_photo_size_check" CHECK ("size_bytes" > 0),
	CONSTRAINT "person_photo_removed_has_time" CHECK ("status" <> 'removed' OR "removed_at" IS NOT NULL),
	CONSTRAINT "person_photo_reason_length" CHECK ("removal_reason" IS NULL OR char_length("removal_reason") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "photo_id" uuid;--> statement-breakpoint
CREATE INDEX "person_photo_id_idx" ON "person" ("photo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_photo_storage_key_key" ON "person_photo" ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "person_photo_one_active_key" ON "person_photo" ("person_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "person_photo_person_id_idx" ON "person_photo" ("person_id");--> statement-breakpoint
CREATE INDEX "person_photo_uploaded_by_user_id_idx" ON "person_photo" ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "person_photo_removed_by_user_id_idx" ON "person_photo" ("removed_by_user_id");--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_photo_id_person_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "person_photo"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "person_photo" ADD CONSTRAINT "person_photo_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "person_photo" ADD CONSTRAINT "person_photo_uploaded_by_user_id_auth_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "person_photo" ADD CONSTRAINT "person_photo_removed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
REVOKE ALL ON TABLE "person_photo" FROM app_public_ro;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "person_photo" TO app_rw;--> statement-breakpoint
CREATE OR REPLACE VIEW "v_public_person" WITH (security_barrier = true) AS
SELECT
  p."id",
  p."slug",
  p."kind",
  p."life_status",
  p."stewardship",
  p."country_code",
  pn."value" AS "display_name",
  COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object('value', n."value", 'script', n."script", 'lang', n."lang",
                                 'kind', n."kind", 'romanization', n."romanization")
              ORDER BY n."sort_order", n."id")
       FROM "person_name" n
      WHERE n."person_id" = p."id" AND NOT n."is_primary"),
    '[]'::jsonb) AS "alt_names",
  (SELECT b."body" FROM "person_bio" b
    WHERE b."person_id" = p."id"
    ORDER BY (b."lang" = 'en') DESC, b."lang"
    LIMIT 1) AS "bio",
  p."created_at",
  p."updated_at",
  (SELECT pl."name" FROM "place" pl WHERE pl."id" = p."place_id") AS "city_name",
  -- M10b (DEFAULT D04/D13): the record of a Sifu account is an instructor, verified once an
  -- archivist approved an instructor_verification case for it; anyone else has none.
  CASE
    WHEN p."stewardship" = 'self' AND EXISTS (
           SELECT 1 FROM "auth_user" u WHERE u."id" = p."claimed_by_user_id" AND u."account_type" = 'sifu')
    THEN CASE
           WHEN EXISTS (
             SELECT 1 FROM "review_case" c
              WHERE c."person_id" = p."id" AND c."kind" = 'instructor_verification'
                AND c."status" = 'resolved' AND c."resolution" = 'approved')
           THEN 'verified'
           ELSE 'unverified'
         END
  END AS "instructor_status",
  -- M14: the current profile photo, only while it is active (a removed or replaced one never).
  (SELECT ph."id" FROM "person_photo" ph
    WHERE ph."id" = p."photo_id" AND ph."person_id" = p."id" AND ph."status" = 'active') AS "photo_id",
  (SELECT ph."sha256" FROM "person_photo" ph
    WHERE ph."id" = p."photo_id" AND ph."person_id" = p."id" AND ph."status" = 'active') AS "photo_sha256"
FROM "person" p
JOIN "person_name" pn ON pn."person_id" = p."id" AND pn."is_primary"
WHERE p."visibility" = 'public' AND p."deleted_at" IS NULL;
