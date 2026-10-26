-- Custom SQL migration (M07): the search keys of public people only. The search reads the keys
-- with app_rw (app_public_ro keeps exactly its three views, plan §6.2); this view is the
-- database's own guarantee that a key of a person who is not public (involved_only,
-- deleted, or without a primary name; DEFAULT D03) can never reach the search, whatever the query
-- around it does. src/server/search/query.ts reads only this view, never person_name_key.
-- Not a security_barrier view: only app_rw reads it, with no functions of its own, and a barrier
-- would keep the planner from using the trigram and prefix indexes of person_name_key.
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
CREATE VIEW "v_public_person_key" AS
SELECT k."person_id", k."person_name_id", k."key", k."key_kind", k."is_primary", k."source"
FROM "person_name_key" k
WHERE EXISTS (SELECT 1 FROM "v_public_person" p WHERE p."id" = k."person_id");
--> statement-breakpoint
GRANT SELECT ON TABLE "v_public_person_key" TO app_rw;
