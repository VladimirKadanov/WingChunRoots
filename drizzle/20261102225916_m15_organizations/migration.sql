-- Generated migration with custom SQL (M15: organizations; docs/adr/0018-organizations.md):
-- - organization: the application's fields (leader's name and title, the approximate number of
--   affiliated schools), the applicant account and who approved it and when; the status
--   'rejected' for a declined application.
-- - organization_admin: an account's authority over an organization (owner or admin), apart from
--   organization_membership (a person's affiliation) and from teaching_relationship (DEFAULT D12).
-- - organization_school: a school's link to an organization, asked by the organization and
--   accepted or refused by the school's listing account; the school and its pin never depend on it.
-- - review_case.organization_id and the kind organization_application, one open per organization.
-- - v_public_organization: approved organizations only, without the applicant, the leader's name,
--   the admins, the plan or any document. Only app_rw reads it; app_public_ro reads none of these
--   tables and not the view (its list stays the three public views of M01).
-- SQL compatible with PostgreSQL 16+ (plan §3.2); ids come from the app (UUIDv7).
CREATE TABLE "organization_admin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"granted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_admin_role_check" CHECK ("role" IN ('owner', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "organization_school" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" uuid,
	"answered_by_user_id" uuid,
	"answered_at" timestamp with time zone,
	"ended_by_user_id" uuid,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_school_status_check" CHECK ("status" IN ('pending', 'accepted', 'refused', 'ended')),
	CONSTRAINT "organization_school_answered_has_time" CHECK ("status" NOT IN ('accepted', 'refused') OR "answered_at" IS NOT NULL),
	CONSTRAINT "organization_school_ended_has_time" CHECK ("status" <> 'ended' OR "ended_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "review_case" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "leader_name" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "leader_title" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "schools_estimate" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
CREATE INDEX "review_case_organization_id_idx" ON "review_case" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_case_one_open_per_organization_key" ON "review_case" ("organization_id","kind") WHERE "organization_id" IS NOT NULL AND "status" IN ('open', 'in_review', 'needs_info');--> statement-breakpoint
CREATE INDEX "organization_created_by_user_id_idx" ON "organization" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "organization_approved_by_user_id_idx" ON "organization" ("approved_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_admin_one_active_key" ON "organization_admin" ("organization_id","user_id") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "organization_admin_user_id_idx" ON "organization_admin" ("user_id");--> statement-breakpoint
CREATE INDEX "organization_admin_granted_by_user_id_idx" ON "organization_admin" ("granted_by_user_id");--> statement-breakpoint
CREATE INDEX "organization_admin_revoked_by_user_id_idx" ON "organization_admin" ("revoked_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_school_one_open_key" ON "organization_school" ("organization_id","school_id") WHERE "status" IN ('pending', 'accepted');--> statement-breakpoint
CREATE INDEX "organization_school_school_id_idx" ON "organization_school" ("school_id");--> statement-breakpoint
CREATE INDEX "organization_school_requested_by_user_id_idx" ON "organization_school" ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "organization_school_answered_by_user_id_idx" ON "organization_school" ("answered_by_user_id");--> statement-breakpoint
CREATE INDEX "organization_school_ended_by_user_id_idx" ON "organization_school" ("ended_by_user_id");--> statement-breakpoint
ALTER TABLE "review_case" ADD CONSTRAINT "review_case_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_approved_by_user_id_auth_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_admin" ADD CONSTRAINT "organization_admin_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_admin" ADD CONSTRAINT "organization_admin_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_admin" ADD CONSTRAINT "organization_admin_granted_by_user_id_auth_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_admin" ADD CONSTRAINT "organization_admin_revoked_by_user_id_auth_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_school" ADD CONSTRAINT "organization_school_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_school" ADD CONSTRAINT "organization_school_school_id_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_school" ADD CONSTRAINT "organization_school_requested_by_user_id_auth_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_school" ADD CONSTRAINT "organization_school_answered_by_user_id_auth_user_id_fkey" FOREIGN KEY ("answered_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_school" ADD CONSTRAINT "organization_school_ended_by_user_id_auth_user_id_fkey" FOREIGN KEY ("ended_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_schools_estimate_range" CHECK ("schools_estimate" IS NULL OR "schools_estimate" BETWEEN 0 AND 100000);--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_name_not_blank" CHECK (btrim("name") <> '');--> statement-breakpoint
ALTER TABLE "review_case" DROP CONSTRAINT "review_case_kind_check", ADD CONSTRAINT "review_case_kind_check" CHECK ("kind" IN ('historical_claim', 'person_claim', 'instructor_verification', 'relationship_dispute', 'profile_report', 'school_listing', 'deletion_request', 'organization_application'));--> statement-breakpoint
ALTER TABLE "organization" DROP CONSTRAINT "organization_status_check", ADD CONSTRAINT "organization_status_check" CHECK ("status" IN ('pending', 'active', 'suspended', 'rejected'));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "organization_admin", "organization_school" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "organization", "organization_membership", "organization_admin", "organization_school" FROM app_public_ro;--> statement-breakpoint
CREATE VIEW "v_public_organization" WITH (security_barrier = true) AS
SELECT
  o."id",
  o."slug",
  o."name",
  o."kind",
  o."country_code",
  o."website_url",
  o."approved_at",
  o."created_at",
  o."updated_at"
FROM "organization" o
WHERE o."status" = 'active' AND o."deleted_at" IS NULL;--> statement-breakpoint
GRANT SELECT ON TABLE "v_public_organization" TO app_rw;
