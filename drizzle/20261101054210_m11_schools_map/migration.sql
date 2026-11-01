-- Generated migration with custom SQL (M11: schools, the map and the lineage filter):
-- - place.alternate_names and place.search_text: the GeoNames alternate names (zh, bg where the
--   source has them) and every name folded for the city search, with a trigram index; the English
--   name stays the one shown (plan §6.2; src/server/geo/places.ts).
-- - school.contact_email, school.contact_phone, school.forms_taught: the listing's contact and the
--   forms it teaches; a name of 2 to 120 characters.
-- - school.status: draft -> pending_review (a school_listing case of the review queue) -> active.
--   The M01 status 'published' becomes 'active' (the demo schools); hidden and archived stay.
-- - review_case: at most one open listing review per school.
-- - v_public_school: only active schools whose pin is allowed (DEFAULT D08/D18: the account that
--   listed the school holds Professional Sifu now; revoking the grant hides the pin and keeps the
--   school), with the new public columns at the end. The CASE on location_privacy stays: the
--   exact point of a city_only school never reaches this view (plan §6.4).
-- No new table, so no new grant: app_rw keeps its privileges on place, school and review_case;
-- app_public_ro still reads only the three public views, never school_private_location.
-- SQL compatible with PostgreSQL 16+ and PostGIS 3.4+ (plan §3.2).
ALTER TABLE "place" ADD COLUMN "alternate_names" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "place" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "school" ADD COLUMN "forms_taught" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_case_one_open_per_school_key" ON "review_case" ("school_id","kind") WHERE "school_id" IS NOT NULL AND "status" IN ('open', 'in_review', 'needs_info');--> statement-breakpoint
CREATE INDEX "place_search_text_trgm_idx" ON "place" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_name_length" CHECK (char_length("name") BETWEEN 2 AND 120);--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_forms_taught_check" CHECK ("forms_taught" <@ ARRAY['siu_nim_tao', 'chum_kiu', 'biu_jee', 'muk_yan_jong', 'luk_dim_boon_kwan', 'baat_jaam_do']::text[]);--> statement-breakpoint
ALTER TABLE "school" DROP CONSTRAINT "school_status_check";--> statement-breakpoint
-- M01's 'published' is M11's 'active'.
UPDATE "school" SET "status" = 'active' WHERE "status" = 'published';--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_status_check" CHECK ("status" IN ('draft', 'pending_review', 'active', 'hidden', 'archived'));--> statement-breakpoint
-- The public schools (plan §6.4). For city_only schools the point is always the city centroid,
-- whatever school.public_point holds. A school is public while it is active, not deleted, and its
-- pin is allowed. DEFAULT D08/D18: the pin needs the account that listed the school
-- (created_by_user_id) to hold Professional Sifu now, the same rule as resolveEffectivePlan() in
-- src/server/entitlements/effective.ts (a Sifu account, a pro_sifu grant that has started, has not
-- ended and is not revoked); revoking the grant hides the pin and keeps the school. A school
-- without a listing account is a record of the platform (the fictional demo schools of M01, D20):
-- no paid pin is involved, so it is shown while active (docs/plan/questions/M11.md, question 2).
-- D12: no pins through an organization before Phase 3.
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
     ORDER BY si."role", si."person_id") AS "instructor_person_ids",
  s."created_at",
  s."updated_at",
  s."contact_email",
  s."contact_phone",
  s."forms_taught"
FROM "school" s
JOIN "place" pl ON pl."id" = s."place_id"
WHERE s."status" = 'active' AND s."deleted_at" IS NULL
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