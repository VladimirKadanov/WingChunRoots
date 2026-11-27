-- Generated migration with custom SQL (journey review 2026-11-26, P1-4; docs/adr/0078-home-line.md):
-- - lineage.featured_on_home: the lineage the home page draws, chosen in the control panel; at
--   most one (a partial unique index). Without one the home page rotates through the public lineages.
-- - v_public_edge.lineage_featured, appended at the end (CREATE OR REPLACE VIEW keeps the existing
--   columns and their order; the filters are unchanged, DEFAULT D03).
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
ALTER TABLE "lineage" ADD COLUMN "featured_on_home" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lineage_featured_on_home_key" ON "lineage" ("featured_on_home") WHERE "featured_on_home";--> statement-breakpoint
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
  -- public source line. The staff-only source note never appears here.
  r."certainty",
  r."public_source",
  -- Journey review 2026-11-26 (P1-4): the lineage the home page draws (at most one).
  l."featured_on_home" AS "lineage_featured"
FROM "teaching_relationship" r
JOIN "person" t ON t."id" = r."teacher_person_id" AND t."visibility" = 'public' AND t."deleted_at" IS NULL
JOIN "person" s ON s."id" = r."student_person_id" AND s."visibility" = 'public' AND s."deleted_at" IS NULL
JOIN "lineage" l ON l."id" = r."lineage_id" AND l."deleted_at" IS NULL
WHERE r."status" IN ('verified', 'in_arbitration') AND r."visibility" = 'public'
  AND EXISTS (SELECT 1 FROM "person_name" tn WHERE tn."person_id" = t."id" AND tn."is_primary")
  AND EXISTS (SELECT 1 FROM "person_name" sn WHERE sn."person_id" = s."id" AND sn."is_primary");
