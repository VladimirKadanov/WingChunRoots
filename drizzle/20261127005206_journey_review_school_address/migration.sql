-- Generated migration (journey review 2026-11-26, P2-7; docs/adr/0083-school-address.md):
-- school.address_line, the street, building and floor of a school, optional and at most 200
-- characters; v_public_school appends it (only for a school with the exact pin, so a city-only
-- club's street is never public). The rest of the view is the definition of m20_school_activity.
-- SQL compatible with PostgreSQL 16+ and PostGIS 3.4+ (plan §3.2).
ALTER TABLE "school" ADD COLUMN "address_line" text;--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_address_line_length" CHECK ("address_line" IS NULL OR char_length("address_line") BETWEEN 1 AND 200);--> statement-breakpoint
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
  s."forms_taught",
  CASE s."location_privacy" WHEN 'exact' THEN s."address_line" END AS "address_line"
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
