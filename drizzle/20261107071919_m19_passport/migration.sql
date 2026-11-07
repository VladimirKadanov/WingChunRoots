-- Generated migration with custom SQL (M19: the training passport; docs/adr/0022-passport.md):
-- - passport_rank, passport_exam, passport_skill, passport_certificate and event_attendance: the
--   entries of a person's passport, each with its visibility (private or public, the student's
--   choice), its status (active, withdrawn, removed) and who wrote and changed it. Nothing is
--   deleted; a plan that shows less only hides (DEFAULT D08). The periods under each teacher are the
--   existing training_period rows.
-- - v_public_passport: the public fields of the active, public entries of people v_public_person
--   shows; an examiner or a teacher only while v_public_person shows them, an organization only while
--   v_public_organization does, an event only while v_public_event shows it published; never an
--   account, a storage key, a proposed correction or a reason of staff. Only app_rw reads it (the
--   service filters it by the plan of the passport's account, In scope 4); app_public_ro keeps
--   exactly its views and reads none of these tables.
-- SQL compatible with PostgreSQL 16+ (plan §3.2); ids come from the app (UUIDv7).
CREATE TABLE "event_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" uuid,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"teacher_person_id" uuid,
	CONSTRAINT "event_attendance_visibility_check" CHECK ("visibility" IN ('private', 'public')),
	CONSTRAINT "event_attendance_status_check" CHECK ("status" IN ('active', 'withdrawn', 'removed')),
	CONSTRAINT "event_attendance_withdrawn_has_time" CHECK ("status" <> 'withdrawn' OR "withdrawn_at" IS NOT NULL),
	CONSTRAINT "event_attendance_removed_has_time" CHECK ("status" <> 'removed' OR "removed_at" IS NOT NULL),
	CONSTRAINT "event_attendance_removal_reason_length" CHECK ("removal_reason" IS NULL OR char_length("removal_reason") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "passport_certificate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" uuid,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text,
	"issued_on" date,
	"precision" text DEFAULT 'unknown' NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	CONSTRAINT "passport_certificate_title_length" CHECK ("title" IS NULL OR char_length("title") BETWEEN 1 AND 200),
	CONSTRAINT "passport_certificate_storage_key_format" CHECK ("storage_key" ~ '^certificates/[0-9a-f]{48}$'),
	CONSTRAINT "passport_certificate_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "passport_certificate_size_check" CHECK ("width" BETWEEN 1 AND 1280 AND "height" BETWEEN 1 AND 1280 AND "size_bytes" > 0),
	CONSTRAINT "passport_certificate_visibility_check" CHECK ("visibility" IN ('private', 'public')),
	CONSTRAINT "passport_certificate_status_check" CHECK ("status" IN ('active', 'withdrawn', 'removed')),
	CONSTRAINT "passport_certificate_withdrawn_has_time" CHECK ("status" <> 'withdrawn' OR "withdrawn_at" IS NOT NULL),
	CONSTRAINT "passport_certificate_removed_has_time" CHECK ("status" <> 'removed' OR "removed_at" IS NOT NULL),
	CONSTRAINT "passport_certificate_removal_reason_length" CHECK ("removal_reason" IS NULL OR char_length("removal_reason") BETWEEN 1 AND 1000),
	CONSTRAINT "passport_certificate_precision_check" CHECK ("precision" IN ('year', 'month', 'day', 'unknown')),
	CONSTRAINT "passport_certificate_date_matches_precision" CHECK (("precision" = 'unknown') = ("issued_on" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "passport_exam" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" uuid,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exam_on" date,
	"precision" text DEFAULT 'unknown' NOT NULL,
	"awarded_rank" text NOT NULL,
	"examiner_person_id" uuid,
	"organization_id" uuid,
	"teacher_person_id" uuid,
	"correction_note" text,
	"correction_at" timestamp with time zone,
	CONSTRAINT "passport_exam_awarded_rank_length" CHECK (char_length("awarded_rank") BETWEEN 1 AND 120),
	CONSTRAINT "passport_exam_examiner_not_self" CHECK ("examiner_person_id" IS NULL OR "examiner_person_id" <> "person_id"),
	CONSTRAINT "passport_exam_visibility_check" CHECK ("visibility" IN ('private', 'public')),
	CONSTRAINT "passport_exam_status_check" CHECK ("status" IN ('active', 'withdrawn', 'removed')),
	CONSTRAINT "passport_exam_withdrawn_has_time" CHECK ("status" <> 'withdrawn' OR "withdrawn_at" IS NOT NULL),
	CONSTRAINT "passport_exam_removed_has_time" CHECK ("status" <> 'removed' OR "removed_at" IS NOT NULL),
	CONSTRAINT "passport_exam_removal_reason_length" CHECK ("removal_reason" IS NULL OR char_length("removal_reason") BETWEEN 1 AND 1000),
	CONSTRAINT "passport_exam_precision_check" CHECK ("precision" IN ('year', 'month', 'day', 'unknown')),
	CONSTRAINT "passport_exam_date_matches_precision" CHECK (("precision" = 'unknown') = ("exam_on" IS NULL)),
	CONSTRAINT "passport_exam_correction_complete" CHECK (("correction_note" IS NULL) = ("correction_at" IS NULL) AND ("correction_note" IS NULL OR char_length("correction_note") BETWEEN 1 AND 1000))
);
--> statement-breakpoint
CREATE TABLE "passport_rank" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" uuid,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rank" text NOT NULL,
	"organization_id" uuid,
	"awarded_on" date,
	"precision" text DEFAULT 'unknown' NOT NULL,
	"teacher_person_id" uuid,
	"correction_note" text,
	"correction_at" timestamp with time zone,
	CONSTRAINT "passport_rank_rank_length" CHECK (char_length("rank") BETWEEN 1 AND 120),
	CONSTRAINT "passport_rank_visibility_check" CHECK ("visibility" IN ('private', 'public')),
	CONSTRAINT "passport_rank_status_check" CHECK ("status" IN ('active', 'withdrawn', 'removed')),
	CONSTRAINT "passport_rank_withdrawn_has_time" CHECK ("status" <> 'withdrawn' OR "withdrawn_at" IS NOT NULL),
	CONSTRAINT "passport_rank_removed_has_time" CHECK ("status" <> 'removed' OR "removed_at" IS NOT NULL),
	CONSTRAINT "passport_rank_removal_reason_length" CHECK ("removal_reason" IS NULL OR char_length("removal_reason") BETWEEN 1 AND 1000),
	CONSTRAINT "passport_rank_precision_check" CHECK ("precision" IN ('year', 'month', 'day', 'unknown')),
	CONSTRAINT "passport_rank_date_matches_precision" CHECK (("precision" = 'unknown') = ("awarded_on" IS NULL)),
	CONSTRAINT "passport_rank_correction_complete" CHECK (("correction_note" IS NULL) = ("correction_at" IS NULL) AND ("correction_note" IS NULL OR char_length("correction_note") BETWEEN 1 AND 1000))
);
--> statement-breakpoint
CREATE TABLE "passport_skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" uuid,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"progress" text DEFAULT 'learning' NOT NULL,
	"since_on" date,
	"precision" text DEFAULT 'unknown' NOT NULL,
	"teacher_person_id" uuid,
	"organization_id" uuid,
	"correction_note" text,
	"correction_at" timestamp with time zone,
	CONSTRAINT "passport_skill_name_length" CHECK (char_length("name") BETWEEN 1 AND 120),
	CONSTRAINT "passport_skill_progress_check" CHECK ("progress" IN ('learning', 'approved')),
	CONSTRAINT "passport_skill_visibility_check" CHECK ("visibility" IN ('private', 'public')),
	CONSTRAINT "passport_skill_status_check" CHECK ("status" IN ('active', 'withdrawn', 'removed')),
	CONSTRAINT "passport_skill_withdrawn_has_time" CHECK ("status" <> 'withdrawn' OR "withdrawn_at" IS NOT NULL),
	CONSTRAINT "passport_skill_removed_has_time" CHECK ("status" <> 'removed' OR "removed_at" IS NOT NULL),
	CONSTRAINT "passport_skill_removal_reason_length" CHECK ("removal_reason" IS NULL OR char_length("removal_reason") BETWEEN 1 AND 1000),
	CONSTRAINT "passport_skill_precision_check" CHECK ("precision" IN ('year', 'month', 'day', 'unknown')),
	CONSTRAINT "passport_skill_date_matches_precision" CHECK (("precision" = 'unknown') = ("since_on" IS NULL)),
	CONSTRAINT "passport_skill_correction_complete" CHECK (("correction_note" IS NULL) = ("correction_at" IS NULL) AND ("correction_note" IS NULL OR char_length("correction_note") BETWEEN 1 AND 1000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "event_attendance_active_key" ON "event_attendance" ("event_id","person_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "event_attendance_person_id_idx" ON "event_attendance" ("person_id");--> statement-breakpoint
CREATE INDEX "event_attendance_teacher_person_id_idx" ON "event_attendance" ("teacher_person_id");--> statement-breakpoint
CREATE INDEX "event_attendance_created_by_user_id_idx" ON "event_attendance" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "event_attendance_withdrawn_by_user_id_idx" ON "event_attendance" ("withdrawn_by_user_id");--> statement-breakpoint
CREATE INDEX "event_attendance_removed_by_user_id_idx" ON "event_attendance" ("removed_by_user_id");--> statement-breakpoint
CREATE INDEX "passport_certificate_person_id_idx" ON "passport_certificate" ("person_id");--> statement-breakpoint
CREATE INDEX "passport_certificate_created_by_user_id_idx" ON "passport_certificate" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "passport_certificate_withdrawn_by_user_id_idx" ON "passport_certificate" ("withdrawn_by_user_id");--> statement-breakpoint
CREATE INDEX "passport_certificate_removed_by_user_id_idx" ON "passport_certificate" ("removed_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passport_certificate_storage_key_key" ON "passport_certificate" ("storage_key");--> statement-breakpoint
CREATE INDEX "passport_exam_person_id_idx" ON "passport_exam" ("person_id","exam_on");--> statement-breakpoint
CREATE INDEX "passport_exam_examiner_person_id_idx" ON "passport_exam" ("examiner_person_id");--> statement-breakpoint
CREATE INDEX "passport_exam_organization_id_idx" ON "passport_exam" ("organization_id");--> statement-breakpoint
CREATE INDEX "passport_exam_teacher_person_id_idx" ON "passport_exam" ("teacher_person_id");--> statement-breakpoint
CREATE INDEX "passport_exam_created_by_user_id_idx" ON "passport_exam" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "passport_exam_withdrawn_by_user_id_idx" ON "passport_exam" ("withdrawn_by_user_id");--> statement-breakpoint
CREATE INDEX "passport_exam_removed_by_user_id_idx" ON "passport_exam" ("removed_by_user_id");--> statement-breakpoint
CREATE INDEX "passport_rank_person_id_idx" ON "passport_rank" ("person_id","awarded_on");--> statement-breakpoint
CREATE INDEX "passport_rank_organization_id_idx" ON "passport_rank" ("organization_id");--> statement-breakpoint
CREATE INDEX "passport_rank_teacher_person_id_idx" ON "passport_rank" ("teacher_person_id");--> statement-breakpoint
CREATE INDEX "passport_rank_created_by_user_id_idx" ON "passport_rank" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "passport_rank_withdrawn_by_user_id_idx" ON "passport_rank" ("withdrawn_by_user_id");--> statement-breakpoint
CREATE INDEX "passport_rank_removed_by_user_id_idx" ON "passport_rank" ("removed_by_user_id");--> statement-breakpoint
CREATE INDEX "passport_skill_person_id_idx" ON "passport_skill" ("person_id","since_on");--> statement-breakpoint
CREATE INDEX "passport_skill_teacher_person_id_idx" ON "passport_skill" ("teacher_person_id");--> statement-breakpoint
CREATE INDEX "passport_skill_organization_id_idx" ON "passport_skill" ("organization_id");--> statement-breakpoint
CREATE INDEX "passport_skill_created_by_user_id_idx" ON "passport_skill" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "passport_skill_withdrawn_by_user_id_idx" ON "passport_skill" ("withdrawn_by_user_id");--> statement-breakpoint
CREATE INDEX "passport_skill_removed_by_user_id_idx" ON "passport_skill" ("removed_by_user_id");--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_withdrawn_by_user_id_auth_user_id_fkey" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_removed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "event_attendance" ADD CONSTRAINT "event_attendance_teacher_person_id_person_id_fkey" FOREIGN KEY ("teacher_person_id") REFERENCES "person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_certificate" ADD CONSTRAINT "passport_certificate_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "passport_certificate" ADD CONSTRAINT "passport_certificate_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_certificate" ADD CONSTRAINT "passport_certificate_withdrawn_by_user_id_auth_user_id_fkey" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_certificate" ADD CONSTRAINT "passport_certificate_removed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_exam" ADD CONSTRAINT "passport_exam_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "passport_exam" ADD CONSTRAINT "passport_exam_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_exam" ADD CONSTRAINT "passport_exam_withdrawn_by_user_id_auth_user_id_fkey" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_exam" ADD CONSTRAINT "passport_exam_removed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_exam" ADD CONSTRAINT "passport_exam_examiner_person_id_person_id_fkey" FOREIGN KEY ("examiner_person_id") REFERENCES "person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_exam" ADD CONSTRAINT "passport_exam_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_exam" ADD CONSTRAINT "passport_exam_teacher_person_id_person_id_fkey" FOREIGN KEY ("teacher_person_id") REFERENCES "person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_rank" ADD CONSTRAINT "passport_rank_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "passport_rank" ADD CONSTRAINT "passport_rank_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_rank" ADD CONSTRAINT "passport_rank_withdrawn_by_user_id_auth_user_id_fkey" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_rank" ADD CONSTRAINT "passport_rank_removed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_rank" ADD CONSTRAINT "passport_rank_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_rank" ADD CONSTRAINT "passport_rank_teacher_person_id_person_id_fkey" FOREIGN KEY ("teacher_person_id") REFERENCES "person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_skill" ADD CONSTRAINT "passport_skill_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "passport_skill" ADD CONSTRAINT "passport_skill_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_skill" ADD CONSTRAINT "passport_skill_withdrawn_by_user_id_auth_user_id_fkey" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_skill" ADD CONSTRAINT "passport_skill_removed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_skill" ADD CONSTRAINT "passport_skill_teacher_person_id_person_id_fkey" FOREIGN KEY ("teacher_person_id") REFERENCES "person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "passport_skill" ADD CONSTRAINT "passport_skill_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "passport_rank", "passport_exam", "passport_skill", "passport_certificate", "event_attendance" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "passport_rank", "passport_exam", "passport_skill", "passport_certificate", "event_attendance" FROM app_public_ro;--> statement-breakpoint
CREATE VIEW "v_public_passport" WITH (security_barrier = true) AS
SELECT
  'rank'::text AS "kind",
  r."id",
  r."person_id",
  r."awarded_on" AS "on_date",
  r."precision",
  r."rank" AS "title",
  NULL::text AS "progress",
  o."slug" AS "organization_slug",
  o."name" AS "organization_name",
  NULL::uuid AS "examiner_person_id",
  NULL::text AS "examiner_slug",
  NULL::text AS "examiner_name",
  NULL::text AS "examiner_lang",
  tp."id" AS "teacher_person_id",
  tp."slug" AS "teacher_slug",
  tp."display_name" AS "teacher_name",
  (SELECT n."lang" FROM "person_name" n WHERE n."person_id" = tp."id" AND n."is_primary" LIMIT 1) AS "teacher_lang",
  NULL::text AS "event_slug",
  NULL::text AS "event_kind",
  NULL::text AS "certificate_sha256",
  NULL::integer AS "certificate_width",
  NULL::integer AS "certificate_height",
  r."created_at"
FROM "passport_rank" r
JOIN "v_public_person" p ON p."id" = r."person_id"
LEFT JOIN "v_public_organization" o ON o."id" = r."organization_id"
LEFT JOIN "v_public_person" tp ON tp."id" = r."teacher_person_id"
WHERE r."status" = 'active' AND r."visibility" = 'public'
UNION ALL
SELECT
  'exam'::text,
  x."id",
  x."person_id",
  x."exam_on",
  x."precision",
  x."awarded_rank",
  NULL::text,
  o."slug",
  o."name",
  ep."id",
  ep."slug",
  ep."display_name",
  (SELECT n."lang" FROM "person_name" n WHERE n."person_id" = ep."id" AND n."is_primary" LIMIT 1),
  tp."id",
  tp."slug",
  tp."display_name",
  (SELECT n."lang" FROM "person_name" n WHERE n."person_id" = tp."id" AND n."is_primary" LIMIT 1),
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::integer,
  NULL::integer,
  x."created_at"
FROM "passport_exam" x
JOIN "v_public_person" p ON p."id" = x."person_id"
LEFT JOIN "v_public_organization" o ON o."id" = x."organization_id"
LEFT JOIN "v_public_person" ep ON ep."id" = x."examiner_person_id"
LEFT JOIN "v_public_person" tp ON tp."id" = x."teacher_person_id"
WHERE x."status" = 'active' AND x."visibility" = 'public'
UNION ALL
SELECT
  'skill'::text,
  k."id",
  k."person_id",
  k."since_on",
  k."precision",
  k."name",
  k."progress",
  o."slug",
  o."name",
  NULL::uuid,
  NULL::text,
  NULL::text,
  NULL::text,
  tp."id",
  tp."slug",
  tp."display_name",
  (SELECT n."lang" FROM "person_name" n WHERE n."person_id" = tp."id" AND n."is_primary" LIMIT 1),
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::integer,
  NULL::integer,
  k."created_at"
FROM "passport_skill" k
JOIN "v_public_person" p ON p."id" = k."person_id"
LEFT JOIN "v_public_organization" o ON o."id" = k."organization_id"
LEFT JOIN "v_public_person" tp ON tp."id" = k."teacher_person_id"
WHERE k."status" = 'active' AND k."visibility" = 'public'
UNION ALL
SELECT
  'certificate'::text,
  c."id",
  c."person_id",
  c."issued_on",
  c."precision",
  c."title",
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::uuid,
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::uuid,
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::text,
  c."sha256",
  c."width",
  c."height",
  c."created_at"
FROM "passport_certificate" c
JOIN "v_public_person" p ON p."id" = c."person_id"
WHERE c."status" = 'active' AND c."visibility" = 'public'
UNION ALL
SELECT
  'attendance'::text,
  a."id",
  a."person_id",
  (e."starts_at" AT TIME ZONE e."timezone")::date,
  'day'::text,
  e."title",
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::uuid,
  NULL::text,
  NULL::text,
  NULL::text,
  tp."id",
  tp."slug",
  tp."display_name",
  (SELECT n."lang" FROM "person_name" n WHERE n."person_id" = tp."id" AND n."is_primary" LIMIT 1),
  e."slug",
  e."kind",
  NULL::text,
  NULL::integer,
  NULL::integer,
  a."created_at"
FROM "event_attendance" a
JOIN "v_public_person" p ON p."id" = a."person_id"
JOIN "v_public_event" e ON e."id" = a."event_id" AND e."status" = 'published'
LEFT JOIN "v_public_person" tp ON tp."id" = a."teacher_person_id"
WHERE a."status" = 'active' AND a."visibility" = 'public';--> statement-breakpoint
GRANT SELECT ON TABLE "v_public_passport" TO app_rw;
