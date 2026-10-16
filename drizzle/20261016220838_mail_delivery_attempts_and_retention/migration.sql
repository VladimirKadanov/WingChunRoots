-- Generated migration (M01b): attempts of email_delivery, and nullable addresses for the
-- retention job (docs/data-model.md §7): to_email and invitation.email are erased when their
-- period ends, but a queued e-mail and a pending invitation always keep theirs (CHECK).
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
ALTER TABLE "email_delivery" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_delivery" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_delivery" ALTER COLUMN "to_email" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "email_delivery_created_at_idx" ON "email_delivery" ("created_at");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_pending_has_email" CHECK ("status" <> 'pending' OR "email" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_attempts_check" CHECK ("attempts" >= 0);--> statement-breakpoint
ALTER TABLE "email_delivery" ADD CONSTRAINT "email_delivery_queued_has_address" CHECK ("status" <> 'queued' OR "to_email" IS NOT NULL);