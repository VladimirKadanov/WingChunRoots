-- Generated migration (M02): the Better Auth tables under the prefix auth_ (plan §3.2, §6.2), the
-- foreign keys from every *_user_id column of M01 to auth_user, the city and the training start
-- year of a person (onboarding), and the consent kinds of the sign-up form (DEFAULT D10). No foreign
-- key on audit_log.actor_user_id: the append-only log outlives accounts (docs/adr/0004-auth.md).
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
CREATE TABLE "auth_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"impersonated_by" uuid,
	"two_factor_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_ip_hmac_format" CHECK ("ip_address" IS NULL OR "ip_address" ~ '^([0-9a-f]{64})?$')
);
--> statement-breakpoint
CREATE TABLE "auth_two_factor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_two_factor_failed_count_check" CHECK ("failed_verification_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_user_role_check" CHECK ("role" IN ('user', 'moderator', 'archivist', 'admin')),
	CONSTRAINT "auth_user_staff_needs_2fa" CHECK ("two_factor_enabled" OR NOT "role" IN ('moderator', 'archivist', 'admin')),
	CONSTRAINT "auth_user_email_lowercase" CHECK ("email" = lower("email"))
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "place_id" uuid;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "training_start_year" integer;--> statement-breakpoint
CREATE INDEX "auth_account_user_id_idx" ON "auth_account" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_account_key" ON "auth_account" ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_session_token_key" ON "auth_session" ("token");--> statement-breakpoint
CREATE INDEX "auth_session_user_id_idx" ON "auth_session" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_two_factor_user_id_key" ON "auth_two_factor" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_user_email_key" ON "auth_user" ("email");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" ("identifier");--> statement-breakpoint
CREATE INDEX "auth_verification_expires_at_idx" ON "auth_verification" ("expires_at");--> statement-breakpoint
CREATE INDEX "person_place_id_idx" ON "person" ("place_id");--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_two_factor" ADD CONSTRAINT "auth_two_factor_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_subject_user_id_auth_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_granted_by_user_id_auth_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_revoked_by_user_id_auth_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_reporter_user_id_auth_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "evidence_file" ADD CONSTRAINT "evidence_file_uploaded_by_user_id_auth_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "review_case" ADD CONSTRAINT "review_case_opened_by_user_id_auth_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "review_case" ADD CONSTRAINT "review_case_assigned_to_user_id_auth_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "review_note" ADD CONSTRAINT "review_note_author_user_id_auth_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "relationship_event" ADD CONSTRAINT "relationship_event_actor_user_id_auth_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "teaching_relationship" ADD CONSTRAINT "teaching_relationship_requested_by_user_id_auth_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "teaching_relationship" ADD CONSTRAINT "teaching_relationship_confirmed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_auth_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_claimed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("claimed_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_place_id_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "place"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "person_claim" ADD CONSTRAINT "person_claim_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "person_claim" ADD CONSTRAINT "person_claim_decided_by_user_id_auth_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_training_start_year_range" CHECK ("training_start_year" IS NULL OR "training_start_year" BETWEEN 1900 AND 2100);--> statement-breakpoint
ALTER TABLE "consent_record" DROP CONSTRAINT "consent_record_kind_check", ADD CONSTRAINT "consent_record_kind_check" CHECK ("kind" IN ('terms', 'privacy_ack', 'authenticity_declaration', 'age_18_plus', 'publication'));