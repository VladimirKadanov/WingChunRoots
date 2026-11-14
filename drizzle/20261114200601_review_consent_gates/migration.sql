-- Review 2026-11-14 (docs/adr/0031-consent-and-living-gates.md): a person whose life status is
-- unknown is treated as living and is never public, until a reviewer has established from evidence
-- that they have died.
--
-- One-off step for rows that exist already, before the CHECK can be added: a record that is public
-- with life status 'unknown' (a historical teacher a committee verified without any rule about
-- death) is hidden again (involved_only), with one audit row per record (ids and shapes only, no
-- actor: the migration did it) and its lineage_membership rows removed, as the worker does when a
-- person stops being public. The record keeps its verified links; it becomes public again when a
-- reviewer sets it to 'deceased' with a written reason (review.ts, archive.update). The membership
-- of the other people of those lineages is recomputed at the next change to the lineage (the
-- worker's lineage.recompute); restart the web process after migrating so no cached page still
-- shows the record. A held (taken down) record only gets its wanted visibility corrected.
WITH hidden AS (
  UPDATE "person" SET "visibility" = 'involved_only', "updated_at" = now()
   WHERE "life_status" = 'unknown' AND "visibility" = 'public'
  RETURNING "id"
), audited AS (
  INSERT INTO "audit_log" ("action", "subject_type", "subject_id", "request_id", "before", "after", "reason")
  SELECT 'person.update', 'person', "id"::text, 'migration-review_consent_gates',
         '{"visibility": "public", "lifeStatus": "unknown"}'::jsonb,
         '{"visibility": "involved_only", "lifeStatus": "unknown", "via": "migration"}'::jsonb,
         'A record whose life status is unknown is treated as living (review 2026-11-14).'
    FROM hidden
  RETURNING 1
)
DELETE FROM "lineage_membership" WHERE "person_id" IN (SELECT "id" FROM hidden);--> statement-breakpoint
UPDATE "person" SET "taken_down_visibility" = 'involved_only'
 WHERE "life_status" = 'unknown' AND "taken_down_visibility" = 'public';--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_unknown_not_public" CHECK ("life_status" <> 'unknown' OR "visibility" = 'involved_only');
