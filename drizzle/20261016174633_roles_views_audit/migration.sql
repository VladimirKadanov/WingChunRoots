-- Custom SQL migration (M01): covering indexes, the public views, the append-only audit log and
-- the privileges of the application roles (plan §6.2, §6.4, §6.6).
--
-- The roles migrator, app_rw and app_public_ro are created once per environment by
-- scripts/db-bootstrap.sql (a superuser, passwords from the environment). Migrations contain
-- only GRANT and REVOKE, never CREATE ROLE or a password.
-- SQL compatible with PostgreSQL 16+ and PostGIS 3.4+ (plan §3.2): no uuidv7(), no virtual
-- generated columns, no OLD/NEW in RETURNING.

-- 1. Covering indexes for the graph queries (plan §6.2, §6.3). Drizzle's index builder has no
--    INCLUDE clause, so they live here.
CREATE INDEX "teaching_relationship_student_cover_idx" ON "teaching_relationship" ("student_person_id") INCLUDE ("teacher_person_id", "status", "lineage_id");
--> statement-breakpoint
CREATE INDEX "teaching_relationship_teacher_cover_idx" ON "teaching_relationship" ("teacher_person_id") INCLUDE ("student_person_id", "status", "lineage_id");
--> statement-breakpoint

-- 2. Public views: the only relations app_public_ro can read. security_barrier keeps the
--    visibility filters ahead of any function a query adds. The views run with the privileges
--    of their owner, so app_public_ro needs no access to the base tables.
-- DEFAULT D03: only people with visibility = 'public'.
CREATE VIEW "v_public_person" WITH (security_barrier = true) AS
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
  p."updated_at"
FROM "person" p
JOIN "person_name" pn ON pn."person_id" = p."id" AND pn."is_primary"
WHERE p."visibility" = 'public' AND p."deleted_at" IS NULL;
--> statement-breakpoint

-- DEFAULT D03: only verified and in_arbitration relationships with visibility = 'public', between
-- two public people in a lineage that is not deleted. Counters and lineage_membership read only
-- this view, so they never reveal a private request (plan §6.2, §4.14).
CREATE VIEW "v_public_edge" WITH (security_barrier = true) AS
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
  r."updated_at"
FROM "teaching_relationship" r
JOIN "person" t ON t."id" = r."teacher_person_id" AND t."visibility" = 'public' AND t."deleted_at" IS NULL
JOIN "person" s ON s."id" = r."student_person_id" AND s."visibility" = 'public' AND s."deleted_at" IS NULL
JOIN "lineage" l ON l."id" = r."lineage_id" AND l."deleted_at" IS NULL
WHERE r."status" IN ('verified', 'in_arbitration') AND r."visibility" = 'public';
--> statement-breakpoint

-- Published schools. For city_only schools the point is always the city centroid, whatever
-- school.public_point holds, so the exact point cannot leak through this view (plan §6.4).
CREATE VIEW "v_public_school" WITH (security_barrier = true) AS
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
  s."updated_at"
FROM "school" s
JOIN "place" pl ON pl."id" = s."place_id"
WHERE s."status" = 'published' AND s."deleted_at" IS NULL;
--> statement-breakpoint

-- 3. Append-only audit log (plan §6.6): a trigger refuses UPDATE, DELETE and TRUNCATE for every
--    role, the superuser included; app_rw additionally has no such privileges (section 4).
CREATE FUNCTION "audit_log_refuse_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_update_delete" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "audit_log_no_truncate" BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_refuse_change"();
--> statement-breakpoint

-- 4. Privileges (plan §6.2). app_rw: the services and the worker. app_public_ro: anonymous reads,
--    only the three views; never school_private_location, evidence_*, birth dates or auth_*.
GRANT USAGE ON SCHEMA public TO app_rw, app_public_ro;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "content_report", "consent_record", "email_delivery", "entitlement_grant", "evidence_file",
  "evidence_link", "invitation", "lineage", "lineage_membership", "notification",
  "organization", "organization_membership", "person", "person_bio", "person_claim",
  "person_name", "person_name_key", "place", "review_case", "review_note", "school",
  "school_instructor", "school_private_location", "teaching_relationship", "training_period"
  TO app_rw;
--> statement-breakpoint
-- Append-only tables: the audit log and the status history of every relationship.
GRANT SELECT, INSERT ON TABLE "audit_log", "relationship_event" TO app_rw;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log", "relationship_event" FROM app_rw;
--> statement-breakpoint
GRANT SELECT ON TABLE "v_public_person", "v_public_edge", "v_public_school" TO app_rw, app_public_ro;
--> statement-breakpoint
-- Explicit, although app_public_ro never received them: the private tables stay closed.
REVOKE ALL ON TABLE "school_private_location", "evidence_file", "evidence_link" FROM app_public_ro;
