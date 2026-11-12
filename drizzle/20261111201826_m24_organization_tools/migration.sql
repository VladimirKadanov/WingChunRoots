CREATE TABLE "organization_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"status" text DEFAULT 'previewed' NOT NULL,
	"file_sha256" text NOT NULL,
	"file_bytes" integer NOT NULL,
	"row_count" integer NOT NULL,
	"valid_count" integer NOT NULL,
	"error_count" integer NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_import_status_check" CHECK ("status" IN ('previewed', 'committed', 'discarded', 'expired')),
	CONSTRAINT "organization_import_sha256_format" CHECK ("file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "organization_import_counts" CHECK ("row_count" BETWEEN 0 AND 500 AND "valid_count" >= 0 AND "error_count" >= 0 AND "valid_count" + "error_count" = "row_count" AND "imported_count" BETWEEN 0 AND "valid_count"),
	CONSTRAINT "organization_import_file_bytes" CHECK ("file_bytes" BETWEEN 0 AND 262144),
	CONSTRAINT "organization_import_ended_has_time" CHECK ("status" = 'previewed' OR "ended_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "organization_import_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"status" text NOT NULL,
	"data" jsonb,
	"errors" jsonb DEFAULT '[]' NOT NULL,
	"person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_import_row_status_check" CHECK ("status" IN ('valid', 'error', 'imported', 'skipped')),
	CONSTRAINT "organization_import_row_number" CHECK ("row_number" >= 2),
	CONSTRAINT "organization_import_row_imported_has_person" CHECK ("status" <> 'imported' OR "person_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "organization_member_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"membership_id" uuid NOT NULL,
	"rank_label" text,
	"school_city" text,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_member_record_lengths" CHECK (("rank_label" IS NULL OR char_length("rank_label") BETWEEN 1 AND 80) AND ("school_city" IS NULL OR char_length("school_city") BETWEEN 1 AND 80))
);
--> statement-breakpoint
CREATE TABLE "organization_teacher_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"student_person_id" uuid NOT NULL,
	"teacher_person_id" uuid NOT NULL,
	"start_year" integer,
	"status" text DEFAULT 'claimed_by_organization' NOT NULL,
	"import_id" uuid,
	"created_by_user_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_user_id" uuid,
	"withdraw_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_teacher_claim_status_check" CHECK ("status" IN ('claimed_by_organization', 'withdrawn')),
	CONSTRAINT "organization_teacher_claim_not_self" CHECK ("student_person_id" <> "teacher_person_id"),
	CONSTRAINT "organization_teacher_claim_start_year" CHECK ("start_year" IS NULL OR "start_year" BETWEEN 1900 AND 2100),
	CONSTRAINT "organization_teacher_claim_withdrawn" CHECK (("status" = 'withdrawn') = ("withdrawn_at" IS NOT NULL) AND ("status" = 'withdrawn') = ("withdraw_reason" IS NOT NULL)),
	CONSTRAINT "organization_teacher_claim_withdraw_reason_check" CHECK ("withdraw_reason" IS NULL OR "withdraw_reason" IN ('organization', 'separation'))
);
--> statement-breakpoint
CREATE INDEX "organization_import_organization_idx" ON "organization_import" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "organization_import_created_by_user_id_idx" ON "organization_import" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "organization_import_ended_by_user_id_idx" ON "organization_import" ("ended_by_user_id");--> statement-breakpoint
CREATE INDEX "organization_import_open_idx" ON "organization_import" ("expires_at") WHERE "status" = 'previewed';--> statement-breakpoint
CREATE UNIQUE INDEX "organization_import_row_key" ON "organization_import_row" ("import_id","row_number");--> statement-breakpoint
CREATE INDEX "organization_import_row_person_id_idx" ON "organization_import_row" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_member_record_membership_key" ON "organization_member_record" ("membership_id");--> statement-breakpoint
CREATE INDEX "organization_member_record_import_id_idx" ON "organization_member_record" ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_teacher_claim_open_key" ON "organization_teacher_claim" ("organization_id","student_person_id","teacher_person_id") WHERE "status" = 'claimed_by_organization';--> statement-breakpoint
CREATE INDEX "organization_teacher_claim_student_idx" ON "organization_teacher_claim" ("student_person_id");--> statement-breakpoint
CREATE INDEX "organization_teacher_claim_teacher_idx" ON "organization_teacher_claim" ("teacher_person_id");--> statement-breakpoint
CREATE INDEX "organization_teacher_claim_import_id_idx" ON "organization_teacher_claim" ("import_id");--> statement-breakpoint
CREATE INDEX "organization_teacher_claim_created_by_user_id_idx" ON "organization_teacher_claim" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "organization_teacher_claim_withdrawn_by_user_id_idx" ON "organization_teacher_claim" ("withdrawn_by_user_id");--> statement-breakpoint
ALTER TABLE "organization_import" ADD CONSTRAINT "organization_import_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_import" ADD CONSTRAINT "organization_import_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_import" ADD CONSTRAINT "organization_import_ended_by_user_id_auth_user_id_fkey" FOREIGN KEY ("ended_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_import_row" ADD CONSTRAINT "organization_import_row_import_id_organization_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "organization_import"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_import_row" ADD CONSTRAINT "organization_import_row_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_member_record" ADD CONSTRAINT "organization_member_record_a4RpyCvljhgq_fkey" FOREIGN KEY ("membership_id") REFERENCES "organization_membership"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_member_record" ADD CONSTRAINT "organization_member_record_smZKIAhxeQFq_fkey" FOREIGN KEY ("import_id") REFERENCES "organization_import"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_teacher_claim" ADD CONSTRAINT "organization_teacher_claim_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_teacher_claim" ADD CONSTRAINT "organization_teacher_claim_student_person_id_person_id_fkey" FOREIGN KEY ("student_person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_teacher_claim" ADD CONSTRAINT "organization_teacher_claim_teacher_person_id_person_id_fkey" FOREIGN KEY ("teacher_person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_teacher_claim" ADD CONSTRAINT "organization_teacher_claim_t3aCkuPADN8T_fkey" FOREIGN KEY ("import_id") REFERENCES "organization_import"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_teacher_claim" ADD CONSTRAINT "organization_teacher_claim_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_teacher_claim" ADD CONSTRAINT "organization_teacher_claim_0ahVXkgiwLoh_fkey" FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "organization_import", "organization_import_row", "organization_member_record", "organization_teacher_claim" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "organization_import", "organization_import_row", "organization_member_record", "organization_teacher_claim" FROM app_public_ro;
