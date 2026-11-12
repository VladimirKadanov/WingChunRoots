-- Generated migration with custom SQL (M25: governance; docs/adr/0028-governance.md; DEFAULT M25,
-- docs/plan/questions/M25.md):
-- - succession_nomination, succession_request: a digital successor among the owner's verified
--   students, and the successor's request after a reported death or more than 180 days of
--   inactivity, always reviewed by an administrator with evidence (review_case succession_request).
-- - lineage_report, decision_appeal: an evidence-based lineage dispute report (it changes nothing by
--   itself) and one appeal per decision, decided by other staff than the original decider.
-- - record_proposal, record_revision: proposed changes to a shared archival record and the record's
--   change history (append-only for app_rw).
-- - auth_user.last_active_at: the last sign-in, kept when sessions end; filled from the sessions.
-- - review_case.kind and review_event.action take the new values.
-- app_rw reads and writes the new tables (record_revision: SELECT and INSERT only); app_public_ro has
-- no privilege on them. SQL compatible with PostgreSQL 16+ (plan §3.2); ids come from the app.
CREATE TABLE "decision_appeal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"appealed_case_id" uuid NOT NULL,
	"appealed_kind" text NOT NULL,
	"decision_event_id" uuid NOT NULL,
	"review_case_id" uuid NOT NULL,
	"appellant_user_id" uuid,
	"original_decider_user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_appeal_status_check" CHECK ("status" IN ('pending', 'upheld', 'rejected')),
	CONSTRAINT "decision_appeal_kind_check" CHECK ("appealed_kind" IN ('relationship_dispute', 'lineage_report', 'succession_request', 'record_proposal'))
);
--> statement-breakpoint
CREATE TABLE "lineage_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"relationship_id" uuid,
	"reporter_user_id" uuid,
	"review_case_id" uuid NOT NULL,
	"grounds" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lineage_report_status_check" CHECK ("status" IN ('open', 'upheld', 'not_upheld')),
	CONSTRAINT "lineage_report_grounds_check" CHECK ("grounds" IN ('never_trained', 'wrong_teacher', 'wrong_dates', 'other'))
);
--> statement-breakpoint
CREATE TABLE "record_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"proposer_user_id" uuid,
	"review_case_id" uuid NOT NULL,
	"proposed" jsonb NOT NULL,
	"base" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_proposal_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "record_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"source" text NOT NULL,
	"actor_user_id" uuid,
	"review_case_id" uuid,
	"changed" text[] NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_revision_source_check" CHECK ("source" IN ('archival_edit', 'proposal')),
	CONSTRAINT "record_revision_reason_not_blank" CHECK (btrim("reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "succession_nomination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_user_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"successor_user_id" uuid NOT NULL,
	"successor_person_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "succession_nomination_status_check" CHECK ("status" IN ('pending', 'accepted', 'declined', 'revoked')),
	CONSTRAINT "succession_nomination_not_self" CHECK ("owner_user_id" <> "successor_user_id"),
	CONSTRAINT "succession_nomination_revoked_at" CHECK (("status" = 'revoked') = ("revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "succession_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"nomination_id" uuid NOT NULL,
	"review_case_id" uuid NOT NULL,
	"requester_user_id" uuid,
	"owner_user_id" uuid,
	"basis" text NOT NULL,
	"inactive_days" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"transferred" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "succession_request_basis_check" CHECK ("basis" IN ('reported_death', 'inactivity')),
	CONSTRAINT "succession_request_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "succession_request_inactive_days" CHECK ("inactive_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_appeal_one_per_decision_key" ON "decision_appeal" ("decision_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_appeal_review_case_id_key" ON "decision_appeal" ("review_case_id");--> statement-breakpoint
CREATE INDEX "decision_appeal_appealed_case_id_idx" ON "decision_appeal" ("appealed_case_id");--> statement-breakpoint
CREATE INDEX "decision_appeal_appellant_user_id_idx" ON "decision_appeal" ("appellant_user_id");--> statement-breakpoint
CREATE INDEX "decision_appeal_original_decider_user_id_idx" ON "decision_appeal" ("original_decider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lineage_report_review_case_id_key" ON "lineage_report" ("review_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lineage_report_one_open_key" ON "lineage_report" ("reporter_user_id","relationship_id") WHERE "status" = 'open' AND "reporter_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "lineage_report_relationship_id_idx" ON "lineage_report" ("relationship_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_proposal_review_case_id_key" ON "record_proposal" ("review_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_proposal_one_pending_key" ON "record_proposal" ("proposer_user_id","person_id") WHERE "status" = 'pending' AND "proposer_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "record_proposal_person_id_idx" ON "record_proposal" ("person_id");--> statement-breakpoint
CREATE INDEX "record_revision_person_id_idx" ON "record_revision" ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "record_revision_actor_user_id_idx" ON "record_revision" ("actor_user_id");--> statement-breakpoint
CREATE INDEX "record_revision_review_case_id_idx" ON "record_revision" ("review_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "succession_nomination_one_live_key" ON "succession_nomination" ("owner_user_id") WHERE "status" IN ('pending', 'accepted');--> statement-breakpoint
CREATE INDEX "succession_nomination_successor_user_id_idx" ON "succession_nomination" ("successor_user_id");--> statement-breakpoint
CREATE INDEX "succession_nomination_owner_person_id_idx" ON "succession_nomination" ("owner_person_id");--> statement-breakpoint
CREATE INDEX "succession_nomination_successor_person_id_idx" ON "succession_nomination" ("successor_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "succession_request_review_case_id_key" ON "succession_request" ("review_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "succession_request_one_pending_key" ON "succession_request" ("nomination_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "succession_request_requester_user_id_idx" ON "succession_request" ("requester_user_id");--> statement-breakpoint
CREATE INDEX "succession_request_owner_user_id_idx" ON "succession_request" ("owner_user_id");--> statement-breakpoint
ALTER TABLE "decision_appeal" ADD CONSTRAINT "decision_appeal_appealed_case_id_review_case_id_fkey" FOREIGN KEY ("appealed_case_id") REFERENCES "review_case"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "decision_appeal" ADD CONSTRAINT "decision_appeal_decision_event_id_review_event_id_fkey" FOREIGN KEY ("decision_event_id") REFERENCES "review_event"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "decision_appeal" ADD CONSTRAINT "decision_appeal_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "decision_appeal" ADD CONSTRAINT "decision_appeal_appellant_user_id_auth_user_id_fkey" FOREIGN KEY ("appellant_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "decision_appeal" ADD CONSTRAINT "decision_appeal_original_decider_user_id_auth_user_id_fkey" FOREIGN KEY ("original_decider_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "lineage_report" ADD CONSTRAINT "lineage_report_relationship_id_teaching_relationship_id_fkey" FOREIGN KEY ("relationship_id") REFERENCES "teaching_relationship"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "lineage_report" ADD CONSTRAINT "lineage_report_reporter_user_id_auth_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "lineage_report" ADD CONSTRAINT "lineage_report_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "record_proposal" ADD CONSTRAINT "record_proposal_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "record_proposal" ADD CONSTRAINT "record_proposal_proposer_user_id_auth_user_id_fkey" FOREIGN KEY ("proposer_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "record_proposal" ADD CONSTRAINT "record_proposal_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "record_revision" ADD CONSTRAINT "record_revision_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "record_revision" ADD CONSTRAINT "record_revision_actor_user_id_auth_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "record_revision" ADD CONSTRAINT "record_revision_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "succession_nomination" ADD CONSTRAINT "succession_nomination_owner_user_id_auth_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "succession_nomination" ADD CONSTRAINT "succession_nomination_owner_person_id_person_id_fkey" FOREIGN KEY ("owner_person_id") REFERENCES "person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "succession_nomination" ADD CONSTRAINT "succession_nomination_successor_user_id_auth_user_id_fkey" FOREIGN KEY ("successor_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "succession_nomination" ADD CONSTRAINT "succession_nomination_successor_person_id_person_id_fkey" FOREIGN KEY ("successor_person_id") REFERENCES "person"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "succession_request" ADD CONSTRAINT "succession_request_nomination_id_succession_nomination_id_fkey" FOREIGN KEY ("nomination_id") REFERENCES "succession_nomination"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "succession_request" ADD CONSTRAINT "succession_request_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "succession_request" ADD CONSTRAINT "succession_request_requester_user_id_auth_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "succession_request" ADD CONSTRAINT "succession_request_owner_user_id_auth_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "review_case" DROP CONSTRAINT "review_case_kind_check", ADD CONSTRAINT "review_case_kind_check" CHECK ("kind" IN ('historical_claim', 'person_claim', 'instructor_verification', 'relationship_dispute', 'profile_report', 'school_listing', 'deletion_request', 'organization_application', 'succession_request', 'lineage_report', 'decision_appeal', 'record_proposal'));--> statement-breakpoint
ALTER TABLE "review_event" DROP CONSTRAINT "review_event_action_check", ADD CONSTRAINT "review_event_action_check" CHECK ("action" IN ('open', 'assign', 'unassign', 'needs_info', 'evidence', 'approve', 'reject', 'dismiss', 'withdraw', 'reopen'));
--> statement-breakpoint
UPDATE "auth_user" u SET "last_active_at" = GREATEST(u."created_at", COALESCE((SELECT max(s."updated_at") FROM "auth_session" s WHERE s."user_id" = u."id"), u."created_at"));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "succession_nomination", "succession_request", "lineage_report", "decision_appeal", "record_proposal" TO app_rw;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "record_revision" TO app_rw;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "record_revision" FROM app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "succession_nomination", "succession_request", "lineage_report", "decision_appeal", "record_proposal", "record_revision" FROM app_public_ro;
