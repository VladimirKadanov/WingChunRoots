CREATE TABLE "federation_trial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"months" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"grant_id" uuid,
	"started_by_user_id" uuid,
	"reason" text NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by_user_id" uuid,
	"converted_subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "federation_trial_status_check" CHECK ("status" IN ('active', 'converted', 'ended', 'revoked')),
	CONSTRAINT "federation_trial_months_check" CHECK ("months" IN (6, 12)),
	CONSTRAINT "federation_trial_period" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "federation_trial_ended" CHECK (("status" = 'active') = ("ended_at" IS NULL)),
	CONSTRAINT "federation_trial_reason_length" CHECK (char_length(btrim("reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "billing_checkout" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD COLUMN "scheduled_plan_code" text;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD COLUMN "scheduled_interval" text;--> statement-breakpoint
ALTER TABLE "billing_test_subscription" ADD COLUMN "scheduled_plan_code" text;--> statement-breakpoint
ALTER TABLE "billing_test_subscription" ADD COLUMN "scheduled_interval" text;--> statement-breakpoint
ALTER TABLE "billing_test_subscription" ADD COLUMN "scheduled_amount_cents" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "federation_trial_organization_key" ON "federation_trial" ("organization_id");--> statement-breakpoint
CREATE INDEX "federation_trial_active_idx" ON "federation_trial" ("ends_at") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "federation_trial_grant_id_idx" ON "federation_trial" ("grant_id");--> statement-breakpoint
CREATE INDEX "federation_trial_started_by_user_id_idx" ON "federation_trial" ("started_by_user_id");--> statement-breakpoint
CREATE INDEX "federation_trial_ended_by_user_id_idx" ON "federation_trial" ("ended_by_user_id");--> statement-breakpoint
CREATE INDEX "federation_trial_converted_subscription_id_idx" ON "federation_trial" ("converted_subscription_id");--> statement-breakpoint
ALTER TABLE "federation_trial" ADD CONSTRAINT "federation_trial_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "federation_trial" ADD CONSTRAINT "federation_trial_grant_id_entitlement_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "entitlement_grant"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "federation_trial" ADD CONSTRAINT "federation_trial_started_by_user_id_auth_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "federation_trial" ADD CONSTRAINT "federation_trial_ended_by_user_id_auth_user_id_fkey" FOREIGN KEY ("ended_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "federation_trial" ADD CONSTRAINT "federation_trial_7BwnK22PHKY3_fkey" FOREIGN KEY ("converted_subscription_id") REFERENCES "billing_subscription"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_scheduled_change" CHECK (("scheduled_plan_code" IS NULL) = ("scheduled_interval" IS NULL));--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_scheduled_plan_code_check" CHECK ("scheduled_plan_code" IS NULL OR "scheduled_plan_code" IN ('free_student', 'premium_student', 'free_sifu', 'pro_sifu', 'federation'));--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_scheduled_interval_check" CHECK ("scheduled_interval" IS NULL OR "scheduled_interval" IN ('month', 'year'));--> statement-breakpoint
ALTER TABLE "billing_test_subscription" ADD CONSTRAINT "billing_test_subscription_scheduled_change" CHECK (("scheduled_plan_code" IS NULL) = ("scheduled_interval" IS NULL) AND ("scheduled_plan_code" IS NULL) = ("scheduled_amount_cents" IS NULL));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "federation_trial" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "federation_trial" FROM app_public_ro;