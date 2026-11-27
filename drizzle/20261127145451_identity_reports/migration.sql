-- Generated migration with custom SQL (owner decisions 2026-11-27; docs/adr/0088-impersonation-reports.md):
-- - identity_report, identity_vouch, identity_code: "This account is pretending to be me", its
--   vouches and its own-channel codes; person.identity_hold_at (the moderators' hold, decision 1);
--   evidence_file.purge_after and the two video types (decisions 2 and 7).
-- - v_public_person.identity_hold appended at the end, and an instructor verification counts only
--   for the account that asked for it (v_public_person.instructor_status and
--   v_public_edge.approved_by_unverified_instructor), so it never passes with a moved profile.
--   CREATE OR REPLACE VIEW keeps the existing columns and their order; the filters are unchanged.
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
CREATE TABLE "identity_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"review_case_id" uuid NOT NULL,
	"side" text NOT NULL,
	"channel" text NOT NULL,
	"requested_by_user_id" uuid,
	"target" text NOT NULL,
	"code_hash" text,
	"public_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_code_side_check" CHECK ("side" IN ('reporter', 'reported')),
	CONSTRAINT "identity_code_channel_check" CHECK ("channel" IN ('email', 'page')),
	CONSTRAINT "identity_code_target_length" CHECK (char_length("target") BETWEEN 1 AND 300),
	CONSTRAINT "identity_code_secret" CHECK (("channel" = 'email' AND "code_hash" ~ '^[0-9a-f]{64}$' AND "public_code" IS NULL) OR ("channel" = 'page' AND "code_hash" IS NULL AND "public_code" ~ '^WCR-[A-Z0-9]{8}$')),
	CONSTRAINT "identity_code_attempts" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "identity_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"review_case_id" uuid NOT NULL,
	"subject_person_id" uuid NOT NULL,
	"reporter_user_id" uuid,
	"reported_user_id" uuid,
	"type" text NOT NULL,
	"route" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"held_at" timestamp with time zone,
	"held_by_user_id" uuid,
	"proof_due_at" timestamp with time zone,
	"hold_until" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_report_type_check" CHECK ("type" IN ('impostor', 'duplicate')),
	CONSTRAINT "identity_report_route_check" CHECK ("route" IN ('vouching', 'channel', 'video', 'own_profile')),
	CONSTRAINT "identity_report_status_check" CHECK ("status" IN ('open', 'held', 'upheld', 'dismissed', 'unsettled', 'closed')),
	CONSTRAINT "identity_report_route_of_type" CHECK (("type" = 'duplicate') = ("route" = 'own_profile')),
	CONSTRAINT "identity_report_held" CHECK ("status" <> 'held' OR ("held_at" IS NOT NULL AND "proof_due_at" IS NOT NULL AND "hold_until" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "identity_vouch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"review_case_id" uuid NOT NULL,
	"side" text NOT NULL,
	"kind" text NOT NULL,
	"voucher_user_id" uuid NOT NULL,
	"voucher_person_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"message" text,
	"answer" text,
	"note" text,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_vouch_side_check" CHECK ("side" IN ('reporter', 'reported')),
	CONSTRAINT "identity_vouch_kind_check" CHECK ("kind" IN ('teacher', 'peer')),
	CONSTRAINT "identity_vouch_answer_check" CHECK ("answer" IS NULL OR "answer" IN ('yes', 'no', 'unsure')),
	CONSTRAINT "identity_vouch_answered" CHECK (("answer" IS NULL) = ("answered_at" IS NULL)),
	CONSTRAINT "identity_vouch_message" CHECK ("message" IS NULL OR char_length("message") BETWEEN 1 AND 500),
	CONSTRAINT "identity_vouch_note" CHECK ("note" IS NULL OR ("answer" IS NOT NULL AND char_length("note") BETWEEN 1 AND 500))
);
--> statement-breakpoint
ALTER TABLE "evidence_file" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "identity_hold_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "evidence_file_purge_after_idx" ON "evidence_file" ("purge_after") WHERE "purge_after" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "identity_code_review_case_id_idx" ON "identity_code" ("review_case_id");--> statement-breakpoint
CREATE INDEX "identity_code_requested_by_user_id_idx" ON "identity_code" ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "identity_code_confirmed_by_user_id_idx" ON "identity_code" ("confirmed_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_report_review_case_id_key" ON "identity_report" ("review_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_report_one_open_key" ON "identity_report" ("reporter_user_id") WHERE "reporter_user_id" IS NOT NULL AND "status" IN ('open', 'held');--> statement-breakpoint
CREATE INDEX "identity_report_subject_person_id_idx" ON "identity_report" ("subject_person_id");--> statement-breakpoint
CREATE INDEX "identity_report_reported_user_id_idx" ON "identity_report" ("reported_user_id");--> statement-breakpoint
CREATE INDEX "identity_report_held_by_user_id_idx" ON "identity_report" ("held_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_vouch_case_side_voucher_key" ON "identity_vouch" ("review_case_id","side","voucher_user_id");--> statement-breakpoint
CREATE INDEX "identity_vouch_voucher_user_id_idx" ON "identity_vouch" ("voucher_user_id");--> statement-breakpoint
CREATE INDEX "identity_vouch_voucher_person_id_idx" ON "identity_vouch" ("voucher_person_id");--> statement-breakpoint
CREATE INDEX "identity_vouch_requested_by_user_id_idx" ON "identity_vouch" ("requested_by_user_id");--> statement-breakpoint
ALTER TABLE "identity_code" ADD CONSTRAINT "identity_code_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity_code" ADD CONSTRAINT "identity_code_requested_by_user_id_auth_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "identity_code" ADD CONSTRAINT "identity_code_confirmed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "identity_report" ADD CONSTRAINT "identity_report_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity_report" ADD CONSTRAINT "identity_report_subject_person_id_person_id_fkey" FOREIGN KEY ("subject_person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity_report" ADD CONSTRAINT "identity_report_reporter_user_id_auth_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "identity_report" ADD CONSTRAINT "identity_report_reported_user_id_auth_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "identity_report" ADD CONSTRAINT "identity_report_held_by_user_id_auth_user_id_fkey" FOREIGN KEY ("held_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "identity_vouch" ADD CONSTRAINT "identity_vouch_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity_vouch" ADD CONSTRAINT "identity_vouch_voucher_user_id_auth_user_id_fkey" FOREIGN KEY ("voucher_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity_vouch" ADD CONSTRAINT "identity_vouch_voucher_person_id_person_id_fkey" FOREIGN KEY ("voucher_person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identity_vouch" ADD CONSTRAINT "identity_vouch_requested_by_user_id_auth_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "evidence_file" DROP CONSTRAINT "evidence_file_mime_check", ADD CONSTRAINT "evidence_file_mime_check" CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm'));--> statement-breakpoint
ALTER TABLE "evidence_file" DROP CONSTRAINT "evidence_file_size_check", ADD CONSTRAINT "evidence_file_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= CASE WHEN "mime" LIKE 'video/%' THEN 52428800 ELSE 20971520 END);--> statement-breakpoint
ALTER TABLE "review_case" DROP CONSTRAINT "review_case_kind_check", ADD CONSTRAINT "review_case_kind_check" CHECK ("kind" IN ('historical_claim', 'person_claim', 'instructor_verification', 'relationship_dispute', 'profile_report', 'school_listing', 'deletion_request', 'organization_application', 'succession_request', 'lineage_report', 'decision_appeal', 'record_proposal', 'identity_report'));--> statement-breakpoint
ALTER TABLE "review_event" DROP CONSTRAINT "review_event_action_check", ADD CONSTRAINT "review_event_action_check" CHECK ("action" IN ('open', 'assign', 'unassign', 'needs_info', 'evidence', 'approve', 'reject', 'dismiss', 'withdraw', 'reopen', 'hold', 'release'));--> statement-breakpoint
-- ADR 0088: the app reads and writes the reports, vouches and codes; the public role never.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "identity_report" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "identity_vouch" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "identity_code" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "identity_report" FROM app_public_ro;--> statement-breakpoint
REVOKE ALL ON TABLE "identity_vouch" FROM app_public_ro;--> statement-breakpoint
REVOKE ALL ON TABLE "identity_code" FROM app_public_ro;--> statement-breakpoint
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
                AND c."status" = 'resolved' AND c."resolution" = 'approved'
                -- ADR 0088: a verification belongs to the account that asked for it, so it does not
                -- pass to the real person when an impersonated profile is moved to them.
                AND (c."opened_by_user_id" IS NULL OR c."opened_by_user_id" = p."claimed_by_user_id"))
           THEN 'verified'
           ELSE 'unverified'
         END
  END AS "instructor_status",
  -- M14: the current profile photo, only while it is active (a removed or replaced one never).
  (SELECT ph."id" FROM "person_photo" ph
    WHERE ph."id" = p."photo_id" AND ph."person_id" = p."id" AND ph."status" = 'active') AS "photo_id",
  (SELECT ph."sha256" FROM "person_photo" ph
    WHERE ph."id" = p."photo_id" AND ph."person_id" = p."id" AND ph."status" = 'active') AS "photo_sha256",
  -- Journey review 2026-11-26 (P1-3): the era of a historical record, as the archive words it.
  p."era_text",
  -- ADR 0088 (decision 1): a moderator found an impersonation report about this profile plausible;
  -- the profile says "Identity under review" instead of its instructor badge.
  (p."identity_hold_at" IS NOT NULL) AS "identity_hold"
FROM "person" p
JOIN "person_name" pn ON pn."person_id" = p."id" AND pn."is_primary"
WHERE p."visibility" = 'public' AND p."deleted_at" IS NULL;--> statement-breakpoint
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
         AND c."status" = 'resolved' AND c."resolution" = 'approved'
         AND (c."opened_by_user_id" IS NULL OR c."opened_by_user_id" = t."claimed_by_user_id")))
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
