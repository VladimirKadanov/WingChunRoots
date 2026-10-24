-- Generated migration (M08: plans, entitlements and dashboards), with the grants added by hand at
-- the end:
-- - auth_user.account_type: Student or Sifu, the account's own choice; it sets the free plan
--   (free_student or free_sifu) and verifies nothing (DEFAULT D04; plan §6.5).
-- - pilot_access_request: "Request pilot access" from an upgrade prompt (plan §5.6): one open
--   request per account; it notifies the admins and never creates a charge.
-- - notification_user_id_unread_idx: the unread count of the dashboard.
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
CREATE TABLE "pilot_access_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_access_request_plan_code_check" CHECK ("plan_code" IN ('free_student', 'premium_student', 'free_sifu', 'pro_sifu', 'federation')),
	CONSTRAINT "pilot_access_request_status_check" CHECK ("status" IN ('open', 'closed')),
	CONSTRAINT "pilot_access_request_closed" CHECK (("status" = 'open') = ("closed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "auth_user" ADD COLUMN "account_type" text DEFAULT 'student' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_access_request_one_open_key" ON "pilot_access_request" ("user_id") WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "pilot_access_request_user_id_idx" ON "pilot_access_request" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "pilot_access_request_status_idx" ON "pilot_access_request" ("status","created_at");--> statement-breakpoint
CREATE INDEX "pilot_access_request_closed_by_user_id_idx" ON "pilot_access_request" ("closed_by_user_id");--> statement-breakpoint
CREATE INDEX "pilot_access_request_grant_id_idx" ON "pilot_access_request" ("grant_id");--> statement-breakpoint
CREATE INDEX "notification_user_id_unread_idx" ON "notification" ("user_id") WHERE "read_at" IS NULL;--> statement-breakpoint
ALTER TABLE "pilot_access_request" ADD CONSTRAINT "pilot_access_request_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pilot_access_request" ADD CONSTRAINT "pilot_access_request_closed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "pilot_access_request" ADD CONSTRAINT "pilot_access_request_grant_id_entitlement_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "entitlement_grant"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "auth_user" ADD CONSTRAINT "auth_user_account_type_check" CHECK ("account_type" IN ('student', 'sifu'));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pilot_access_request" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "pilot_access_request" FROM app_public_ro;
