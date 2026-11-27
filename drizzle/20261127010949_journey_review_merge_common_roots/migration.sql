-- Generated migration with custom SQL (journey review 2026-11-26, P2-10; docs/adr/0086-archive-duplicates.md):
-- - person_redirect: the address of a record merged into another one, for a permanent redirect.
--   app_rw reads and writes it; app_public_ro has no right on it.
-- - lineage.common_roots: the shared teachers before the branches split; at most one (a partial
--   unique index).
-- - v_public_edge.lineage_common_roots, appended at the end (CREATE OR REPLACE VIEW keeps the
--   existing columns and their order; the filters are unchanged, DEFAULT D03).
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
CREATE TABLE "person_redirect" (
	"from_slug" text PRIMARY KEY,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lineage" ADD COLUMN "common_roots" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lineage_common_roots_key" ON "lineage" ("common_roots") WHERE "common_roots";--> statement-breakpoint
CREATE INDEX "person_redirect_person_id_idx" ON "person_redirect" ("person_id");--> statement-breakpoint
ALTER TABLE "person_redirect" ADD CONSTRAINT "person_redirect_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "person_redirect" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "person_redirect" FROM app_public_ro;--> statement-breakpoint
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
  l."featured_on_home" AS "lineage_featured",
  -- Journey review 2026-11-26 (P2-10): the shared teachers before the branches split.
  l."common_roots" AS "lineage_common_roots"
FROM "teaching_relationship" r
JOIN "person" t ON t."id" = r."teacher_person_id" AND t."visibility" = 'public' AND t."deleted_at" IS NULL
JOIN "person" s ON s."id" = r."student_person_id" AND s."visibility" = 'public' AND s."deleted_at" IS NULL
JOIN "lineage" l ON l."id" = r."lineage_id" AND l."deleted_at" IS NULL
WHERE r."status" IN ('verified', 'in_arbitration') AND r."visibility" = 'public'
  AND EXISTS (SELECT 1 FROM "person_name" tn WHERE tn."person_id" = t."id" AND tn."is_primary")
  AND EXISTS (SELECT 1 FROM "person_name" sn WHERE sn."person_id" = s."id" AND sn."is_primary");
