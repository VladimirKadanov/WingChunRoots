CREATE TABLE "entitlement_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"subject_user_id" uuid,
	"subject_organization_id" uuid,
	"plan_code" text NOT NULL,
	"source" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"granted_by_user_id" uuid,
	"reason" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_grant_one_subject" CHECK (num_nonnulls("subject_user_id", "subject_organization_id") = 1),
	CONSTRAINT "entitlement_grant_plan_code_check" CHECK ("plan_code" IN ('free_student', 'premium_student', 'free_sifu', 'pro_sifu', 'federation')),
	CONSTRAINT "entitlement_grant_source_check" CHECK ("source" IN ('test_grant', 'complimentary', 'stripe')),
	CONSTRAINT "entitlement_grant_period" CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at"),
	CONSTRAINT "entitlement_grant_reason_not_blank" CHECK (btrim("reason") <> ''),
	CONSTRAINT "entitlement_grant_revoke_reason" CHECK ("revoked_at" IS NULL OR "revoke_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "content_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"reporter_user_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"review_case_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_report_subject_type_check" CHECK ("subject_type" IN ('person', 'teaching_relationship', 'school', 'person_name')),
	CONSTRAINT "content_report_reason_check" CHECK ("reason" IN ('incorrect', 'impersonation', 'privacy', 'offensive', 'other')),
	CONSTRAINT "content_report_status_check" CHECK ("status" IN ('open', 'triaged', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "evidence_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"original_sha256" text,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"retention_until" timestamp with time zone,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "evidence_file_scan_status_check" CHECK ("scan_status" IN ('pending', 'clean', 'rejected')),
	CONSTRAINT "evidence_file_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evidence_file_original_sha256_format" CHECK ("original_sha256" IS NULL OR "original_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evidence_file_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 20971520)
);
--> statement-breakpoint
CREATE TABLE "evidence_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"evidence_file_id" uuid NOT NULL,
	"review_case_id" uuid,
	"relationship_id" uuid,
	"person_id" uuid,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_link_one_subject" CHECK (num_nonnulls("review_case_id", "relationship_id", "person_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "review_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"relationship_id" uuid,
	"person_id" uuid,
	"school_id" uuid,
	"opened_by_user_id" uuid,
	"assigned_to_user_id" uuid,
	"resolution" text,
	"resolution_reason" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_case_kind_check" CHECK ("kind" IN ('historical_claim', 'person_claim', 'instructor_verification', 'relationship_dispute', 'profile_report', 'school_listing', 'deletion_request')),
	CONSTRAINT "review_case_status_check" CHECK ("status" IN ('open', 'in_review', 'needs_info', 'resolved', 'dismissed')),
	CONSTRAINT "review_case_resolution_check" CHECK ("resolution" IS NULL OR "resolution" IN ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "review_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"review_case_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lineage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"root_person_id" uuid,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "lineage_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "lineage_membership" (
	"lineage_id" uuid,
	"person_id" uuid,
	"depth" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lineage_membership_pkey" PRIMARY KEY("lineage_id","person_id"),
	CONSTRAINT "lineage_membership_depth_check" CHECK ("depth" IS NULL OR "depth" >= 0)
);
--> statement-breakpoint
CREATE TABLE "relationship_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"relationship_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_event_from_status_check" CHECK ("from_status" IS NULL OR "from_status" IN ('pending_teacher', 'awaiting_claim', 'under_review', 'verified', 'rejected', 'withdrawn', 'in_arbitration', 'revoked')),
	CONSTRAINT "relationship_event_to_status_check" CHECK ("to_status" IN ('pending_teacher', 'awaiting_claim', 'under_review', 'verified', 'rejected', 'withdrawn', 'in_arbitration', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "teaching_relationship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"teacher_person_id" uuid NOT NULL,
	"student_person_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"status" text NOT NULL,
	"verification_path" text DEFAULT 'teacher_approval' NOT NULL,
	"is_display_primary" boolean DEFAULT false NOT NULL,
	"visibility" text DEFAULT 'involved_only' NOT NULL,
	"requested_by_user_id" uuid,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teaching_relationship_not_self" CHECK ("teacher_person_id" <> "student_person_id"),
	CONSTRAINT "teaching_relationship_status_check" CHECK ("status" IN ('pending_teacher', 'awaiting_claim', 'under_review', 'verified', 'rejected', 'withdrawn', 'in_arbitration', 'revoked')),
	CONSTRAINT "teaching_relationship_verification_path_check" CHECK ("verification_path" IN ('teacher_approval', 'committee_review')),
	CONSTRAINT "teaching_relationship_visibility_check" CHECK ("visibility" IN ('involved_only', 'public')),
	CONSTRAINT "teaching_relationship_public_only_after_verification" CHECK ("visibility" = 'involved_only' OR "status" IN ('verified', 'in_arbitration', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "training_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"relationship_id" uuid NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"precision" text DEFAULT 'unknown' NOT NULL,
	"ongoing" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_period_precision_check" CHECK ("precision" IN ('year', 'month', 'day', 'unknown')),
	CONSTRAINT "training_period_ongoing_has_no_end" CHECK (NOT "ongoing" OR "ends_on" IS NULL),
	CONSTRAINT "training_period_end_after_start" CHECK ("ends_on" IS NULL OR "starts_on" IS NULL OR "ends_on" >= "starts_on"),
	CONSTRAINT "training_period_unknown_has_no_dates" CHECK ("precision" <> 'unknown' OR ("starts_on" IS NULL AND "ends_on" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"country_code" text,
	"website_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organization_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "organization_kind_check" CHECK ("kind" IN ('federation', 'association', 'school_group')),
	CONSTRAINT "organization_status_check" CHECK ("status" IN ('pending', 'active', 'suspended')),
	CONSTRAINT "organization_country_code_format" CHECK ("country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "organization_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_membership_role_check" CHECK ("role" IN ('leader', 'admin', 'member')),
	CONSTRAINT "organization_membership_dates" CHECK ("ends_on" IS NULL OR "starts_on" IS NULL OR "ends_on" >= "starts_on")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"relationship_id" uuid,
	"invited_by_user_id" uuid,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_status_check" CHECK ("status" IN ('pending', 'accepted', 'expired', 'revoked')),
	CONSTRAINT "invitation_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"life_status" text DEFAULT 'unknown' NOT NULL,
	"stewardship" text DEFAULT 'unclaimed' NOT NULL,
	"visibility" text DEFAULT 'involved_only' NOT NULL,
	"claimed_by_user_id" uuid,
	"created_by_user_id" uuid,
	"country_code" text,
	"birth_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "person_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "person_kind_check" CHECK ("kind" IN ('living', 'historical')),
	CONSTRAINT "person_life_status_check" CHECK ("life_status" IN ('living', 'deceased', 'unknown')),
	CONSTRAINT "person_stewardship_check" CHECK ("stewardship" IN ('self', 'platform', 'unclaimed')),
	CONSTRAINT "person_visibility_check" CHECK ("visibility" IN ('involved_only', 'public')),
	CONSTRAINT "person_self_needs_account" CHECK ("stewardship" <> 'self' OR "claimed_by_user_id" IS NOT NULL),
	CONSTRAINT "person_country_code_format" CHECK ("country_code" IS NULL OR "country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "person_bio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_bio_lang_format" CHECK ("lang" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$')
);
--> statement-breakpoint
CREATE TABLE "person_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"review_case_id" uuid,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_claim_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "person_name" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"kind" text DEFAULT 'name' NOT NULL,
	"value" text NOT NULL,
	"script" text NOT NULL,
	"lang" text NOT NULL,
	"romanization" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_name_kind_check" CHECK ("kind" IN ('name', 'alias', 'romanization')),
	CONSTRAINT "person_name_romanization_check" CHECK ("romanization" IS NULL OR "romanization" IN ('jyutping', 'pinyin', 'yale', 'hk_gov', 'bg_streamlined')),
	CONSTRAINT "person_name_script_format" CHECK ("script" ~ '^[A-Z][a-z]{3}$'),
	CONSTRAINT "person_name_lang_format" CHECK ("lang" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$'),
	CONSTRAINT "person_name_value_not_blank" CHECK (btrim("value") <> ''),
	CONSTRAINT "person_name_primary_is_latin" CHECK (NOT "is_primary" OR ("script" = 'Latn' AND "kind" = 'name'))
);
--> statement-breakpoint
CREATE TABLE "person_name_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"person_name_id" uuid NOT NULL,
	"key" text NOT NULL,
	"key_kind" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_name_key_kind_check" CHECK ("key_kind" IN ('latin', 'jyutping', 'pinyin', 'han', 'cyrillic'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"request_id" text,
	"ip_hmac" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"evidence_ids" uuid[],
	"prev_hash" text,
	"hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_action_format" CHECK ("action" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
	CONSTRAINT "audit_log_ip_hmac_format" CHECK ("ip_hmac" IS NULL OR "ip_hmac" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "consent_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"document_version" text NOT NULL,
	"action" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_record_kind_check" CHECK ("kind" IN ('terms', 'privacy', 'age_18_plus', 'publication')),
	CONSTRAINT "consent_record_action_check" CHECK ("action" IN ('granted', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid,
	"to_email" text NOT NULL,
	"template" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_delivery_status_check" CHECK ("status" IN ('queued', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"template" text NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"geonames_id" integer NOT NULL,
	"name" text NOT NULL,
	"ascii_name" text NOT NULL,
	"country_code" text NOT NULL,
	"admin1_code" text,
	"feature_code" text,
	"population" integer,
	"timezone" text,
	"centroid" geography(Point,4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_country_code_format" CHECK ("country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "school" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"place_id" uuid NOT NULL,
	"location_privacy" text DEFAULT 'city_only' NOT NULL,
	"public_point" geography(Point,4326) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text,
	"website_url" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "school_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "school_location_privacy_check" CHECK ("location_privacy" IN ('exact', 'city_only')),
	CONSTRAINT "school_status_check" CHECK ("status" IN ('draft', 'published', 'hidden', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "school_instructor" (
	"school_id" uuid,
	"person_id" uuid,
	"role" text DEFAULT 'instructor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_instructor_pkey" PRIMARY KEY("school_id","person_id"),
	CONSTRAINT "school_instructor_role_check" CHECK ("role" IN ('head_instructor', 'instructor', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "school_private_location" (
	"school_id" uuid PRIMARY KEY,
	"exact_point" geography(Point,4326) NOT NULL,
	"address_line" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "entitlement_grant_subject_user_id_idx" ON "entitlement_grant" ("subject_user_id");--> statement-breakpoint
CREATE INDEX "entitlement_grant_subject_organization_id_idx" ON "entitlement_grant" ("subject_organization_id");--> statement-breakpoint
CREATE INDEX "content_report_subject_idx" ON "content_report" ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "content_report_status_idx" ON "content_report" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_file_storage_key_key" ON "evidence_file" ("storage_key");--> statement-breakpoint
CREATE INDEX "evidence_file_sha256_idx" ON "evidence_file" ("sha256");--> statement-breakpoint
CREATE INDEX "evidence_link_evidence_file_id_idx" ON "evidence_link" ("evidence_file_id");--> statement-breakpoint
CREATE INDEX "evidence_link_review_case_id_idx" ON "evidence_link" ("review_case_id");--> statement-breakpoint
CREATE INDEX "evidence_link_relationship_id_idx" ON "evidence_link" ("relationship_id");--> statement-breakpoint
CREATE INDEX "evidence_link_person_id_idx" ON "evidence_link" ("person_id");--> statement-breakpoint
CREATE INDEX "review_case_status_idx" ON "review_case" ("status","kind");--> statement-breakpoint
CREATE INDEX "review_case_relationship_id_idx" ON "review_case" ("relationship_id");--> statement-breakpoint
CREATE INDEX "review_case_person_id_idx" ON "review_case" ("person_id");--> statement-breakpoint
CREATE INDEX "review_case_school_id_idx" ON "review_case" ("school_id");--> statement-breakpoint
CREATE INDEX "review_case_assigned_to_user_id_idx" ON "review_case" ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "review_note_review_case_id_idx" ON "review_note" ("review_case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lineage_slug_key" ON "lineage" ("slug");--> statement-breakpoint
CREATE INDEX "lineage_root_person_id_idx" ON "lineage" ("root_person_id");--> statement-breakpoint
CREATE INDEX "lineage_membership_person_id_idx" ON "lineage_membership" ("person_id");--> statement-breakpoint
CREATE INDEX "relationship_event_relationship_id_idx" ON "relationship_event" ("relationship_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "teaching_relationship_active_key" ON "teaching_relationship" ("teacher_person_id","student_person_id","lineage_id") WHERE "status" IN ('pending_teacher', 'awaiting_claim', 'under_review', 'verified', 'in_arbitration');--> statement-breakpoint
CREATE UNIQUE INDEX "teaching_relationship_one_display_primary_key" ON "teaching_relationship" ("student_person_id") WHERE "is_display_primary" AND "status" IN ('pending_teacher', 'awaiting_claim', 'under_review', 'verified', 'in_arbitration');--> statement-breakpoint
CREATE INDEX "teaching_relationship_lineage_id_idx" ON "teaching_relationship" ("lineage_id");--> statement-breakpoint
CREATE INDEX "training_period_relationship_id_idx" ON "training_period" ("relationship_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_key" ON "organization" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_membership_key" ON "organization_membership" ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "organization_membership_person_id_idx" ON "organization_membership" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation" ("token_hash");--> statement-breakpoint
CREATE INDEX "invitation_person_id_idx" ON "invitation" ("person_id");--> statement-breakpoint
CREATE INDEX "invitation_relationship_id_idx" ON "invitation" ("relationship_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_slug_key" ON "person" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "person_claimed_by_user_id_key" ON "person" ("claimed_by_user_id") WHERE "claimed_by_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "person_visibility_idx" ON "person" ("visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "person_bio_person_lang_key" ON "person_bio" ("person_id","lang");--> statement-breakpoint
CREATE INDEX "person_claim_person_id_idx" ON "person_claim" ("person_id");--> statement-breakpoint
CREATE INDEX "person_claim_user_id_idx" ON "person_claim" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_claim_one_pending_key" ON "person_claim" ("person_id","user_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "person_name_person_id_idx" ON "person_name" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_name_one_primary_key" ON "person_name" ("person_id") WHERE "is_primary";--> statement-breakpoint
CREATE INDEX "person_name_key_person_id_idx" ON "person_name_key" ("person_id");--> statement-breakpoint
CREATE INDEX "person_name_key_person_name_id_idx" ON "person_name_key" ("person_name_id");--> statement-breakpoint
CREATE INDEX "person_name_key_trgm_idx" ON "person_name_key" USING gin ("key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "person_name_key_prefix_idx" ON "person_name_key" ("key" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log" ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log" ("actor_user_id");--> statement-breakpoint
CREATE INDEX "consent_record_user_id_idx" ON "consent_record" ("user_id","kind","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_idempotency_key_key" ON "email_delivery" ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_delivery_status_idx" ON "email_delivery" ("status");--> statement-breakpoint
CREATE INDEX "notification_user_id_idx" ON "notification" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "place_geonames_id_key" ON "place" ("geonames_id");--> statement-breakpoint
CREATE INDEX "place_country_code_idx" ON "place" ("country_code");--> statement-breakpoint
CREATE INDEX "place_centroid_gist_idx" ON "place" USING gist ("centroid");--> statement-breakpoint
CREATE UNIQUE INDEX "school_slug_key" ON "school" ("slug");--> statement-breakpoint
CREATE INDEX "school_place_id_idx" ON "school" ("place_id");--> statement-breakpoint
CREATE INDEX "school_status_idx" ON "school" ("status");--> statement-breakpoint
CREATE INDEX "school_public_point_gist_idx" ON "school" USING gist ("public_point");--> statement-breakpoint
CREATE INDEX "school_instructor_person_id_idx" ON "school_instructor" ("person_id");--> statement-breakpoint
CREATE INDEX "school_private_location_exact_point_gist_idx" ON "school_private_location" USING gist ("exact_point");--> statement-breakpoint
ALTER TABLE "entitlement_grant" ADD CONSTRAINT "entitlement_grant_subject_organization_id_organization_id_fkey" FOREIGN KEY ("subject_organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content_report" ADD CONSTRAINT "content_report_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_evidence_file_id_evidence_file_id_fkey" FOREIGN KEY ("evidence_file_id") REFERENCES "evidence_file"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_relationship_id_teaching_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "teaching_relationship"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_case" ADD CONSTRAINT "review_case_relationship_id_teaching_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "teaching_relationship"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "review_case" ADD CONSTRAINT "review_case_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "review_case" ADD CONSTRAINT "review_case_school_id_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "review_note" ADD CONSTRAINT "review_note_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "lineage" ADD CONSTRAINT "lineage_root_person_id_person_id_fkey" FOREIGN KEY ("root_person_id") REFERENCES "person"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "lineage_membership" ADD CONSTRAINT "lineage_membership_lineage_id_lineage_id_fkey" FOREIGN KEY ("lineage_id") REFERENCES "lineage"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "lineage_membership" ADD CONSTRAINT "lineage_membership_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "relationship_event" ADD CONSTRAINT "relationship_event_rXzULOL9Ks97_fkey" FOREIGN KEY ("relationship_id") REFERENCES "teaching_relationship"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "teaching_relationship" ADD CONSTRAINT "teaching_relationship_teacher_person_id_person_id_fkey" FOREIGN KEY ("teacher_person_id") REFERENCES "person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "teaching_relationship" ADD CONSTRAINT "teaching_relationship_student_person_id_person_id_fkey" FOREIGN KEY ("student_person_id") REFERENCES "person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "teaching_relationship" ADD CONSTRAINT "teaching_relationship_lineage_id_lineage_id_fkey" FOREIGN KEY ("lineage_id") REFERENCES "lineage"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "training_period" ADD CONSTRAINT "training_period_relationship_id_teaching_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "teaching_relationship"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_membership" ADD CONSTRAINT "organization_membership_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_membership" ADD CONSTRAINT "organization_membership_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_relationship_id_teaching_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "teaching_relationship"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "person_bio" ADD CONSTRAINT "person_bio_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "person_claim" ADD CONSTRAINT "person_claim_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "person_claim" ADD CONSTRAINT "person_claim_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "person_name" ADD CONSTRAINT "person_name_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "person_name_key" ADD CONSTRAINT "person_name_key_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "person_name_key" ADD CONSTRAINT "person_name_key_person_name_id_person_name_id_fkey" FOREIGN KEY ("person_name_id") REFERENCES "person_name"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "school" ADD CONSTRAINT "school_place_id_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "place"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "school_instructor" ADD CONSTRAINT "school_instructor_school_id_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "school_instructor" ADD CONSTRAINT "school_instructor_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "school_private_location" ADD CONSTRAINT "school_private_location_school_id_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE;