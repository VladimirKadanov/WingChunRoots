CREATE TABLE "naming_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"person_id" uuid,
	"organization_id" uuid,
	"event_id" uuid,
	"position" integer,
	"rank_id" uuid,
	"exam_id" uuid,
	"skill_id" uuid,
	"role" text,
	"starts_on" date,
	"email" text,
	"expires_at" timestamp with time zone,
	"asked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "naming_request_kind_check" CHECK ("kind" IN ('organization_member', 'event_instructor', 'exam_examiner', 'entry_issuer', 'organization_admin')),
	CONSTRAINT "naming_request_status_check" CHECK ("status" IN ('pending', 'in_review')),
	CONSTRAINT "naming_request_shape" CHECK (coalesce(CASE "kind"
        WHEN 'organization_member' THEN "person_id" IS NOT NULL AND "organization_id" IS NOT NULL AND "role" IN ('leader', 'admin', 'member')
        WHEN 'event_instructor' THEN "person_id" IS NOT NULL AND "event_id" IS NOT NULL AND "position" BETWEEN 0 AND 4
        WHEN 'exam_examiner' THEN "person_id" IS NOT NULL AND "exam_id" IS NOT NULL
        WHEN 'entry_issuer' THEN "organization_id" IS NOT NULL AND num_nonnulls("rank_id", "exam_id", "skill_id") = 1 AND "status" = 'pending'
        WHEN 'organization_admin' THEN "organization_id" IS NOT NULL AND "email" IS NOT NULL AND "expires_at" IS NOT NULL AND "status" = 'pending'
          AND "role" IN ('owner', 'admin')
      END, false)),
	CONSTRAINT "naming_request_email_lower" CHECK ("email" IS NULL OR "email" = lower("email"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "naming_request_member_key" ON "naming_request" ("organization_id","person_id") WHERE "kind" = 'organization_member';--> statement-breakpoint
CREATE UNIQUE INDEX "naming_request_instructor_key" ON "naming_request" ("event_id","person_id") WHERE "kind" = 'event_instructor';--> statement-breakpoint
CREATE UNIQUE INDEX "naming_request_examiner_key" ON "naming_request" ("exam_id") WHERE "kind" = 'exam_examiner';--> statement-breakpoint
CREATE UNIQUE INDEX "naming_request_issuer_rank_key" ON "naming_request" ("rank_id") WHERE "kind" = 'entry_issuer';--> statement-breakpoint
CREATE UNIQUE INDEX "naming_request_issuer_exam_key" ON "naming_request" ("exam_id") WHERE "kind" = 'entry_issuer';--> statement-breakpoint
CREATE UNIQUE INDEX "naming_request_issuer_skill_key" ON "naming_request" ("skill_id") WHERE "kind" = 'entry_issuer';--> statement-breakpoint
CREATE UNIQUE INDEX "naming_request_admin_key" ON "naming_request" ("organization_id","email") WHERE "kind" = 'organization_admin';--> statement-breakpoint
CREATE INDEX "naming_request_person_id_idx" ON "naming_request" ("person_id");--> statement-breakpoint
CREATE INDEX "naming_request_organization_id_idx" ON "naming_request" ("organization_id");--> statement-breakpoint
CREATE INDEX "naming_request_event_id_idx" ON "naming_request" ("event_id");--> statement-breakpoint
CREATE INDEX "naming_request_rank_id_idx" ON "naming_request" ("rank_id");--> statement-breakpoint
CREATE INDEX "naming_request_exam_id_idx" ON "naming_request" ("exam_id");--> statement-breakpoint
CREATE INDEX "naming_request_skill_id_idx" ON "naming_request" ("skill_id");--> statement-breakpoint
CREATE INDEX "naming_request_email_idx" ON "naming_request" ("email");--> statement-breakpoint
CREATE INDEX "naming_request_asked_by_user_id_idx" ON "naming_request" ("asked_by_user_id");--> statement-breakpoint
CREATE INDEX "naming_request_review_idx" ON "naming_request" ("status","created_at");--> statement-breakpoint
ALTER TABLE "naming_request" ADD CONSTRAINT "naming_request_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "naming_request" ADD CONSTRAINT "naming_request_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "naming_request" ADD CONSTRAINT "naming_request_event_id_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "naming_request" ADD CONSTRAINT "naming_request_rank_id_passport_rank_id_fkey" FOREIGN KEY ("rank_id") REFERENCES "passport_rank"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "naming_request" ADD CONSTRAINT "naming_request_exam_id_passport_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "passport_exam"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "naming_request" ADD CONSTRAINT "naming_request_skill_id_passport_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "passport_skill"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "naming_request" ADD CONSTRAINT "naming_request_asked_by_user_id_auth_user_id_fkey" FOREIGN KEY ("asked_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "naming_request" TO app_rw;
