CREATE TABLE "claim_confirmation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"review_case_id" uuid NOT NULL,
	"relationship_id" uuid NOT NULL,
	"teacher_user_id" uuid NOT NULL,
	"asked_by_user_id" uuid,
	"answer" text,
	"note" text,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_confirmation_answer_check" CHECK ("answer" IS NULL OR "answer" IN ('yes', 'no', 'unsure')),
	CONSTRAINT "claim_confirmation_answered" CHECK (("answer" IS NULL) = ("answered_at" IS NULL)),
	CONSTRAINT "claim_confirmation_note" CHECK ("note" IS NULL OR ("answer" IS NOT NULL AND char_length("note") BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "claim_confirmation_case_teacher_key" ON "claim_confirmation" ("review_case_id","teacher_user_id");--> statement-breakpoint
CREATE INDEX "claim_confirmation_teacher_user_id_idx" ON "claim_confirmation" ("teacher_user_id");--> statement-breakpoint
CREATE INDEX "claim_confirmation_relationship_id_idx" ON "claim_confirmation" ("relationship_id");--> statement-breakpoint
CREATE INDEX "claim_confirmation_asked_by_user_id_idx" ON "claim_confirmation" ("asked_by_user_id");--> statement-breakpoint
ALTER TABLE "claim_confirmation" ADD CONSTRAINT "claim_confirmation_review_case_id_review_case_id_fkey" FOREIGN KEY ("review_case_id") REFERENCES "review_case"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claim_confirmation" ADD CONSTRAINT "claim_confirmation_HZCt8ETedqKI_fkey" FOREIGN KEY ("relationship_id") REFERENCES "teaching_relationship"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claim_confirmation" ADD CONSTRAINT "claim_confirmation_teacher_user_id_auth_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claim_confirmation" ADD CONSTRAINT "claim_confirmation_asked_by_user_id_auth_user_id_fkey" FOREIGN KEY ("asked_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
-- ADR 0067: a reviewer's question to a teacher about a profile claim. The app reads and writes it; the public role never.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "claim_confirmation" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "claim_confirmation" FROM app_public_ro;
