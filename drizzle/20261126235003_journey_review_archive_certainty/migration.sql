-- Generated migration with custom SQL (journey review 2026-11-26, P1-3; docs/adr/0077-legend-and-record.md):
-- - teaching_relationship.certainty ('documented', 'traditional', 'disputed') and public_source
--   (a short public "According to …" line), for links the archive entered; both public.
-- - person.era_text: the era of a historical record ("d. 1901", "active 1850s to 1880s"); public.
-- - v_public_edge.certainty and public_source, v_public_person.era_text, appended at the end
--   (CREATE OR REPLACE VIEW keeps the existing columns and their order; the filters are unchanged,
--   DEFAULT D03). source_note stays staff-only.
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
ALTER TABLE "teaching_relationship" ADD COLUMN "certainty" text;--> statement-breakpoint
ALTER TABLE "teaching_relationship" ADD COLUMN "public_source" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "era_text" text;--> statement-breakpoint
ALTER TABLE "teaching_relationship" ADD CONSTRAINT "teaching_relationship_certainty_check" CHECK ("certainty" IS NULL OR "certainty" IN ('documented', 'traditional', 'disputed'));--> statement-breakpoint
ALTER TABLE "teaching_relationship" ADD CONSTRAINT "teaching_relationship_public_source_length" CHECK ("public_source" IS NULL OR char_length("public_source") BETWEEN 1 AND 300);--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_era_text_length" CHECK ("era_text" IS NULL OR char_length("era_text") BETWEEN 1 AND 60);--> statement-breakpoint
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
    WHERE ph."id" = p."photo_id" AND ph."person_id" = p."id" AND ph."status" = 'active') AS "photo_sha256",
  -- Journey review 2026-11-26 (P1-3): the era of a historical record, as the archive words it.
  p."era_text"
FROM "person" p
JOIN "person_name" pn ON pn."person_id" = p."id" AND pn."is_primary"
WHERE p."visibility" = 'public' AND p."deleted_at" IS NULL;--> statement-breakpoint
CREATE OR REPLACE VIEW "v_public_edge" WITH (security_barrier = true) AS
SELECT
  r."id",
  r."teacher_person_id",
  r."student_person_id",
  r."lineage_id",
  r."status",
  r."verification_path",
  r."is_display_primary",
  r."visibility",
  r."confirmed_at",
  COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object('startsOn', tp."starts_on", 'endsOn', tp."ends_on",
                                 'precision', tp."precision", 'ongoing', tp."ongoing")
              ORDER BY tp."sort_order", tp."starts_on" NULLS FIRST, tp."id")
       FROM "training_period" tp
      WHERE tp."relationship_id" = r."id"),
    '[]'::jsonb) AS "periods",
  r."created_at",
  r."updated_at",
  l."slug" AS "lineage_slug",
  l."name" AS "lineage_name",
  (SELECT rp."id" FROM "person" rp
    WHERE rp."id" = l."root_person_id" AND rp."visibility" = 'public' AND rp."deleted_at" IS NULL
      AND EXISTS (SELECT 1 FROM "person_name" rn WHERE rn."person_id" = rp."id" AND rn."is_primary"))
    AS "lineage_root_person_id",
  -- M10b (DEFAULT D04/D13): the teacher approved the link from their own account and no archivist
  -- has verified them as an instructor yet.
  (r."verification_path" = 'teacher_approval'
    AND r."confirmed_by_user_id" IS NOT NULL
    AND r."confirmed_by_user_id" = t."claimed_by_user_id"
    AND NOT EXISTS (
      SELECT 1 FROM "review_case" c
       WHERE c."person_id" = t."id" AND c."kind" = 'instructor_verification'
         AND c."status" = 'resolved' AND c."resolution" = 'approved'))
    AS "approved_by_unverified_instructor",
  -- Journey review 2026-11-26 (P1-3): how sure the archive is of a link it entered, and its
  -- public source line. The staff-only source_note never appears here.
  r."certainty",
  r."public_source"
FROM "teaching_relationship" r
JOIN "person" t ON t."id" = r."teacher_person_id" AND t."visibility" = 'public' AND t."deleted_at" IS NULL
JOIN "person" s ON s."id" = r."student_person_id" AND s."visibility" = 'public' AND s."deleted_at" IS NULL
JOIN "lineage" l ON l."id" = r."lineage_id" AND l."deleted_at" IS NULL
WHERE r."status" IN ('verified', 'in_arbitration') AND r."visibility" = 'public'
  AND EXISTS (SELECT 1 FROM "person_name" tn WHERE tn."person_id" = t."id" AND tn."is_primary")
  AND EXISTS (SELECT 1 FROM "person_name" sn WHERE sn."person_id" = s."id" AND sn."is_primary");
