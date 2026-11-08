-- Generated migration with custom SQL (M20: school activity checks; docs/adr/0023-school-activity.md;
-- specification §7.3, DEFAULT D17, D18):
-- - school.activity_stage, activity_awaiting_since, activity_hidden_at: the stage of the activity
--   check, stored (never computed from dates at read time). `current`; `awaiting_confirmation` from
--   day 90 without an edit or a confirmation (the owner is asked; still public); `hidden` from day
--   105 (off every public answer, never deleted). Existing schools start `current`.
-- - school_activity_stage_times: each stage carries exactly its timestamps.
-- - school_activity_check_idx: the daily job's passes over the listed schools of an account.
-- - v_public_school: the same columns, and a hidden school is not public (DEFAULT D18: the pin
--   returns only when the stage is current or awaiting again and every other condition holds: the
--   listing is active, the account holds Professional Sifu, nothing is deleted). Every public read
--   (the finder, the map, the school page, search, the sitemap, Open Graph and JSON-LD, the
--   organization and event pages) goes through this view, so none of them needs its own filter.
-- No new table, so no new grant: app_rw keeps its privileges on school; app_public_ro still reads
-- only the public views. SQL compatible with PostgreSQL 16+ and PostGIS 3.4+ (plan §3.2).
ALTER TABLE "school" ADD COLUMN "activity_stage" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "activity_awaiting_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "activity_hidden_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "school_activity_check_idx" ON "school" ("activity_stage","last_activity_at") WHERE "status" = 'active' AND "deleted_at" IS NULL AND "created_by_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_activity_stage_check" CHECK ("activity_stage" IN ('current', 'awaiting_confirmation', 'hidden'));--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_activity_stage_times" CHECK (("activity_stage" = 'current' AND "activity_awaiting_since" IS NULL AND "activity_hidden_at" IS NULL)
        OR ("activity_stage" = 'awaiting_confirmation' AND "activity_awaiting_since" IS NOT NULL AND "activity_hidden_at" IS NULL)
        OR ("activity_stage" = 'hidden' AND "activity_awaiting_since" IS NOT NULL AND "activity_hidden_at" IS NOT NULL));--> statement-breakpoint
-- The public schools (plan §6.4), as in M11, with the activity check (DEFAULT D17, D18).
CREATE OR REPLACE VIEW "v_public_school" WITH (security_barrier = true) AS
SELECT
  s."id",
  s."slug",
  s."name",
  s."location_privacy",
  CASE s."location_privacy" WHEN 'exact' THEN 'exact' ELSE 'city' END AS "precision",
  CASE s."location_privacy" WHEN 'exact' THEN s."public_point" ELSE pl."centroid" END AS "public_point",
  s."place_id",
  pl."name" AS "city_name",
  pl."country_code",
  s."description",
  s."website_url",
  s."last_activity_at",
  ARRAY(
    SELECT si."person_id"
      FROM "school_instructor" si
      JOIN "person" ip ON ip."id" = si."person_id" AND ip."visibility" = 'public' AND ip."deleted_at" IS NULL
     WHERE si."school_id" = s."id"
       AND (si."role" = 'head_instructor' OR EXISTS (
         SELECT 1
           FROM "school_instructor" h
           JOIN "teaching_relationship" r ON r."teacher_person_id" = h."person_id" AND r."student_person_id" = si."person_id"
          WHERE h."school_id" = s."id" AND h."role" = 'head_instructor' AND r."status" IN ('verified', 'in_arbitration')))
     ORDER BY si."role", si."person_id") AS "instructor_person_ids",
  s."created_at",
  s."updated_at",
  s."contact_email",
  s."contact_phone",
  s."forms_taught"
FROM "school" s
JOIN "place" pl ON pl."id" = s."place_id"
WHERE s."status" = 'active' AND s."deleted_at" IS NULL
  AND s."activity_stage" <> 'hidden'
  AND (
    s."created_by_user_id" IS NULL
    OR EXISTS (
      SELECT 1
        FROM "auth_user" u
        JOIN "entitlement_grant" g ON g."subject_user_id" = u."id"
       WHERE u."id" = s."created_by_user_id" AND u."account_type" = 'sifu'
         AND g."plan_code" = 'pro_sifu'
         AND g."starts_at" <= now()
         AND (g."ends_at" IS NULL OR g."ends_at" > now())
         AND (g."revoked_at" IS NULL OR g."revoked_at" > now())));
