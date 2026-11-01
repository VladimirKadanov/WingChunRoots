-- Generated migration (M10b: invitations, profile claims, instructor verification, profile reports
-- and arbitration), with the custom part at the end:
-- - review_event: the append-only history of a review case, with the idempotency key of the change
--   (plan §5.6); app_rw may only SELECT and INSERT it, as relationship_event. Its actor is SET NULL
--   when the account is deleted (as content_report's reporter): the history never stops an erasure.
-- - invitation.accepted_by_user_id and invitation.idempotency_key (single use, one invitation per
--   key); review_case: at most one open instructor verification per person.
-- - content_report: the reasons of "Report profile" (copyright, spam, inappropriate, misleading; the
--   table was empty until now) and one report per account and subject (In scope 4).
-- - v_public_person.instructor_status and v_public_edge.approved_by_unverified_instructor (plan
--   §6.5, DEFAULT D04/D13): "Instructor (unverified)" and "Approved by an unverified instructor",
--   derived inside the views (owner's rights) so app_public_ro still reads only its three views and
--   never auth_user or review_case. Both columns are appended (CREATE OR REPLACE VIEW keeps the
--   existing columns and their order; the filters are unchanged, DEFAULT D03).
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
CREATE TABLE "review_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"review_case_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_event_idempotency_key_format" CHECK ("idempotency_key" IS NULL OR "idempotency_key" ~ '^[A-Za-z0-9_-]{8,64}$'),
	CONSTRAINT "review_event_action_check" CHECK ("action" IN ('open', 'assign', 'unassign', 'needs_info', 'evidence', 'approve', 'reject', 'dismiss', 'withdraw')),
	CONSTRAINT "review_event_from_status_check" CHECK ("from_status" IS NULL OR "from_status" IN ('open', 'in_review', 'needs_info', 'resolved', 'dismissed')),
	CONSTRAINT "review_event_to_status_check" CHECK ("to_status" IN ('open', 'in_review', 'needs_info', 'resolved', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "accepted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "content_report_one_per_reporter_key" ON "content_report" ("reporter_user_id","subject_type","subject_id") WHERE "reporter_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "review_case_one_open_instructor_key" ON "review_case" ("person_id") WHERE "person_id" IS NOT NULL AND "kind" = 'instructor_verification' AND "status" IN ('open', 'in_review', 'needs_info');--> statement-breakpoint
CREATE INDEX "review_event_review_case_id_idx" ON "review_event" ("review_case_id","created_at");--> statement-breakpoint
CREATE INDEX "review_event_actor_user_id_idx" ON "review_event" ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_event_idempotency_key" ON "review_event" ("actor_user_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "invitation_accepted_by_user_id_idx" ON "invitation" ("accepted_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_idempotency_key" ON "invitation" ("invited_by_user_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "review_event" ADD CONSTRAINT "review_event_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "review_event" ADD CONSTRAINT "review_event_actor_user_id_auth_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_user_id_auth_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_details_length" CHECK ("details" IS NULL OR char_length("details") BETWEEN 1 AND 1000);--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_idempotency_key_format" CHECK ("idempotency_key" IS NULL OR "idempotency_key" ~ '^[A-Za-z0-9_-]{8,64}$');--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_has_account" CHECK ("status" <> 'accepted' OR "accepted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "content_report" DROP CONSTRAINT "content_report_reason_check", ADD CONSTRAINT "content_report_reason_check" CHECK ("reason" IN ('copyright', 'spam', 'inappropriate', 'misleading'));--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "review_event" TO app_rw;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "review_event" FROM app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "review_event" FROM app_public_ro;--> statement-breakpoint
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
  END AS "instructor_status"
FROM "person" p
JOIN "person_name" pn ON pn."person_id" = p."id" AND pn."is_primary"
WHERE p."visibility" = 'public' AND p."deleted_at" IS NULL;
--> statement-breakpoint
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
    AS "approved_by_unverified_instructor"
FROM "teaching_relationship" r
JOIN "person" t ON t."id" = r."teacher_person_id" AND t."visibility" = 'public' AND t."deleted_at" IS NULL
JOIN "person" s ON s."id" = r."student_person_id" AND s."visibility" = 'public' AND s."deleted_at" IS NULL
JOIN "lineage" l ON l."id" = r."lineage_id" AND l."deleted_at" IS NULL
WHERE r."status" IN ('verified', 'in_arbitration') AND r."visibility" = 'public'
  AND EXISTS (SELECT 1 FROM "person_name" tn WHERE tn."person_id" = t."id" AND tn."is_primary")
  AND EXISTS (SELECT 1 FROM "person_name" sn WHERE sn."person_id" = s."id" AND sn."is_primary");
