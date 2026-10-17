-- Custom SQL migration (M01 review): the database itself guarantees that school.public_point
-- never holds the exact location of a city_only school, and v_public_edge never names a person
-- that v_public_person leaves out (plan §6.2, §6.3, §6.4).
-- SQL compatible with PostgreSQL 16+ and PostGIS 3.4+ (plan §3.2).
--
-- Correction to the comment of 20261016174610_extensions (left unchanged, since applied
-- migrations are never edited): migrations always run as migrator (SET ROLE), never as a
-- superuser, so that file cannot create postgis. scripts/db-bootstrap.sql creates it as a
-- superuser before any migration, and the IF NOT EXISTS of that file only confirms it.
--
-- v_public_school keeps its CASE on location_privacy as a second line of defence: a radius query
-- through that security_barrier view cannot use the GiST index anyway (ST_DWithin is not
-- leakproof, so the planner keeps it above the view's own filters), and the radius query of plan
-- §6.3 runs as app_rw on school.public_point, which section 1 makes safe.

-- 1. school.public_point is the city centroid for every city_only school (plan §6.4). Before,
--    only v_public_school swapped the centroid in, so the radius query of plan §6.3 (run by
--    app_rw on school.public_point) could measure distances to the exact point and allow
--    triangulation. A BEFORE trigger now overwrites public_point for city_only schools on every
--    insert and on every change of location_privacy, place_id or public_point; an AFTER trigger
--    on place follows a corrected city centroid. The exact point lives only in
--    school_private_location.
CREATE FUNCTION "school_city_only_point"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  city_centroid geography;
BEGIN
  IF NEW.location_privacy = 'city_only' THEN
    SELECT p.centroid INTO city_centroid FROM place p WHERE p.id = NEW.place_id;
    -- An unknown place_id is left to the foreign key, which reports it properly.
    IF FOUND THEN
      NEW.public_point := city_centroid;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "school_city_only_point" BEFORE INSERT OR UPDATE OF "location_privacy", "place_id", "public_point" ON "school"
  FOR EACH ROW EXECUTE FUNCTION "school_city_only_point"();
--> statement-breakpoint
CREATE FUNCTION "place_centroid_to_city_only_schools"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE school SET public_point = NEW.centroid
   WHERE place_id = NEW.id AND location_privacy = 'city_only';
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "place_centroid_to_city_only_schools" AFTER UPDATE OF "centroid" ON "place"
  FOR EACH ROW EXECUTE FUNCTION "place_centroid_to_city_only_schools"();
--> statement-breakpoint
-- Rows written before this migration.
UPDATE "school" s SET "public_point" = p."centroid"
  FROM "place" p
 WHERE p."id" = s."place_id" AND s."location_privacy" = 'city_only';
--> statement-breakpoint

-- 2. DEFAULT D03: v_public_edge requires of both ends exactly what v_public_person requires
--    (public, not deleted, a primary name), so every edge points at a node the public graph has.
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
  r."updated_at"
FROM "teaching_relationship" r
JOIN "person" t ON t."id" = r."teacher_person_id" AND t."visibility" = 'public' AND t."deleted_at" IS NULL
JOIN "person" s ON s."id" = r."student_person_id" AND s."visibility" = 'public' AND s."deleted_at" IS NULL
JOIN "lineage" l ON l."id" = r."lineage_id" AND l."deleted_at" IS NULL
WHERE r."status" IN ('verified', 'in_arbitration') AND r."visibility" = 'public'
  AND EXISTS (SELECT 1 FROM "person_name" tn WHERE tn."person_id" = t."id" AND tn."is_primary")
  AND EXISTS (SELECT 1 FROM "person_name" sn WHERE sn."person_id" = s."id" AND sn."is_primary");
