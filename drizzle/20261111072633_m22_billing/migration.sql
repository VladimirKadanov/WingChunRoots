-- Generated migration with custom SQL (M22: payments in test mode; docs/adr/0025-billing.md;
-- DEFAULT D06, D08, D09 and DEFAULT M22, docs/plan/questions/M22.md):
-- - billing_customer, billing_checkout, billing_subscription, billing_event, billing_invoice: the
--   provider's customers, the checkouts the app started, the subscriptions as the provider's events
--   say (one live subscription per account or organization), every verified event (unique per
--   provider event id; redacted raw copy, no card data) and the invoices (the payment history).
-- - billing_test_subscription: the store of the local test provider (no real charge).
-- - notification_preference: the new category `billing`, whose e-mail cannot be switched off.
-- A subscription drives an entitlement_grant with source 'stripe' (the source M08 kept for Phase 2):
-- no change to entitlement_grant, its views or v_public_school. app_rw reads and writes the new
-- tables; app_public_ro has no privilege on them. SQL compatible with PostgreSQL 16+ (plan §3.2);
-- ids come from the app (UUIDv7).
CREATE TABLE "billing_checkout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider" text NOT NULL,
	"subject_user_id" uuid,
	"subject_organization_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"interval" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"provider_session_id" text,
	"provider_subscription_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_checkout_one_subject" CHECK (num_nonnulls("subject_user_id", "subject_organization_id") = 1),
	CONSTRAINT "billing_checkout_provider_check" CHECK ("provider" IN ('test', 'stripe')),
	CONSTRAINT "billing_checkout_plan_code_check" CHECK ("plan_code" IN ('free_student', 'premium_student', 'free_sifu', 'pro_sifu', 'federation')),
	CONSTRAINT "billing_checkout_interval_check" CHECK ("interval" IN ('month', 'year')),
	CONSTRAINT "billing_checkout_status_check" CHECK ("status" IN ('open', 'completed', 'expired')),
	CONSTRAINT "billing_checkout_amount" CHECK ("amount_cents" > 0),
	CONSTRAINT "billing_checkout_completed" CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "billing_customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"subject_user_id" uuid,
	"subject_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customer_one_subject" CHECK (num_nonnulls("subject_user_id", "subject_organization_id") = 1),
	CONSTRAINT "billing_customer_provider_check" CHECK ("provider" IN ('test', 'stripe')),
	CONSTRAINT "billing_customer_provider_id_length" CHECK (char_length("provider_customer_id") BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE TABLE "billing_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_type" text NOT NULL,
	"normalized" jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"object_id" text,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"subscription_id" uuid,
	"provider_created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_event_provider_check" CHECK ("provider" IN ('test', 'stripe')),
	CONSTRAINT "billing_event_outcome_check" CHECK ("outcome" IN ('pending', 'applied', 'stale', 'unknown', 'mismatch', 'ignored', 'conflict')),
	CONSTRAINT "billing_event_processed" CHECK (("outcome" = 'pending') = ("processed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "billing_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"subscription_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_invoice_id" text NOT NULL,
	"status" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoice_provider_check" CHECK ("provider" IN ('test', 'stripe')),
	CONSTRAINT "billing_invoice_status_check" CHECK ("status" IN ('paid', 'failed')),
	CONSTRAINT "billing_invoice_amount" CHECK ("amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"provider" text NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"checkout_id" uuid,
	"subject_user_id" uuid,
	"subject_organization_id" uuid,
	"plan_code" text NOT NULL,
	"interval" text NOT NULL,
	"status" text NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"past_due_since" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"provider_version" bigint NOT NULL,
	"grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscription_one_subject" CHECK (num_nonnulls("subject_user_id", "subject_organization_id") = 1),
	CONSTRAINT "billing_subscription_provider_check" CHECK ("provider" IN ('test', 'stripe')),
	CONSTRAINT "billing_subscription_plan_code_check" CHECK ("plan_code" IN ('free_student', 'premium_student', 'free_sifu', 'pro_sifu', 'federation')),
	CONSTRAINT "billing_subscription_interval_check" CHECK ("interval" IN ('month', 'year')),
	CONSTRAINT "billing_subscription_status_check" CHECK ("status" IN ('incomplete', 'active', 'past_due', 'canceled')),
	CONSTRAINT "billing_subscription_end_reason_check" CHECK ("end_reason" IS NULL OR "end_reason" IN ('canceled', 'unpaid', 'provider')),
	CONSTRAINT "billing_subscription_period" CHECK ("current_period_end" > "current_period_start"),
	CONSTRAINT "billing_subscription_ended" CHECK (("status" = 'canceled') = ("ended_at" IS NOT NULL AND "end_reason" IS NOT NULL)),
	CONSTRAINT "billing_subscription_past_due_since" CHECK ("status" <> 'past_due' OR "past_due_since" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "billing_test_subscription" (
	"id" text PRIMARY KEY,
	"customer_id" text NOT NULL,
	"checkout_ref" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"interval" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"card" text NOT NULL,
	"status" text NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"version" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_test_subscription_card_check" CHECK ("card" IN ('succeeds', 'declines', 'fails_at_renewal')),
	CONSTRAINT "billing_test_subscription_status_check" CHECK ("status" IN ('incomplete', 'active', 'past_due', 'canceled')),
	CONSTRAINT "billing_test_subscription_period" CHECK ("current_period_end" > "current_period_start")
);
--> statement-breakpoint
CREATE INDEX "billing_checkout_user_idx" ON "billing_checkout" ("subject_user_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_checkout_organization_idx" ON "billing_checkout" ("subject_organization_id");--> statement-breakpoint
CREATE INDEX "billing_checkout_created_by_user_id_idx" ON "billing_checkout" ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customer_provider_key" ON "billing_customer" ("provider","provider_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customer_user_key" ON "billing_customer" ("provider","subject_user_id") WHERE "subject_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customer_organization_key" ON "billing_customer" ("provider","subject_organization_id") WHERE "subject_organization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_event_provider_key" ON "billing_event" ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "billing_event_subscription_idx" ON "billing_event" ("subscription_id","received_at");--> statement-breakpoint
CREATE INDEX "billing_event_object_idx" ON "billing_event" ("provider","object_id");--> statement-breakpoint
CREATE INDEX "billing_event_received_idx" ON "billing_event" ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_invoice_provider_key" ON "billing_invoice" ("provider","provider_invoice_id");--> statement-breakpoint
CREATE INDEX "billing_invoice_subscription_idx" ON "billing_invoice" ("subscription_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscription_provider_key" ON "billing_subscription" ("provider","provider_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscription_one_live_user_key" ON "billing_subscription" ("subject_user_id") WHERE "subject_user_id" IS NOT NULL AND "status" IN ('active', 'past_due');--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscription_one_live_organization_key" ON "billing_subscription" ("subject_organization_id") WHERE "subject_organization_id" IS NOT NULL AND "status" IN ('active', 'past_due');--> statement-breakpoint
CREATE INDEX "billing_subscription_user_idx" ON "billing_subscription" ("subject_user_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_subscription_organization_idx" ON "billing_subscription" ("subject_organization_id");--> statement-breakpoint
CREATE INDEX "billing_subscription_customer_id_idx" ON "billing_subscription" ("customer_id");--> statement-breakpoint
CREATE INDEX "billing_subscription_checkout_id_idx" ON "billing_subscription" ("checkout_id");--> statement-breakpoint
CREATE INDEX "billing_subscription_grant_id_idx" ON "billing_subscription" ("grant_id");--> statement-breakpoint
CREATE INDEX "billing_subscription_past_due_idx" ON "billing_subscription" ("past_due_since") WHERE "status" = 'past_due';--> statement-breakpoint
CREATE UNIQUE INDEX "billing_test_subscription_checkout_key" ON "billing_test_subscription" ("checkout_ref");--> statement-breakpoint
ALTER TABLE "billing_checkout" ADD CONSTRAINT "billing_checkout_subject_user_id_auth_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing_checkout" ADD CONSTRAINT "billing_checkout_subject_organization_id_organization_id_fkey" FOREIGN KEY ("subject_organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing_checkout" ADD CONSTRAINT "billing_checkout_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing_customer" ADD CONSTRAINT "billing_customer_subject_user_id_auth_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing_customer" ADD CONSTRAINT "billing_customer_subject_organization_id_organization_id_fkey" FOREIGN KEY ("subject_organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing_event" ADD CONSTRAINT "billing_event_subscription_id_billing_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "billing_subscription"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billing_invoice" ADD CONSTRAINT "billing_invoice_subscription_id_billing_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "billing_subscription"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_customer_id_billing_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "billing_customer"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_checkout_id_billing_checkout_id_fkey" FOREIGN KEY ("checkout_id") REFERENCES "billing_checkout"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_subject_user_id_auth_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_zQuJFqdcNsaC_fkey" FOREIGN KEY ("subject_organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_grant_id_entitlement_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "entitlement_grant"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notification_preference" DROP CONSTRAINT "notification_preference_category_check", ADD CONSTRAINT "notification_preference_category_check" CHECK ("category" IN ('security', 'account', 'plan', 'teaching', 'review', 'schools', 'organizations', 'events', 'billing'));--> statement-breakpoint
ALTER TABLE "notification_preference" DROP CONSTRAINT "notification_preference_locked_categories", ADD CONSTRAINT "notification_preference_locked_categories" CHECK ("email" OR "category" NOT IN ('security', 'account', 'billing'));;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "billing_customer", "billing_checkout", "billing_subscription", "billing_event", "billing_invoice", "billing_test_subscription" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "billing_customer", "billing_checkout", "billing_subscription", "billing_event", "billing_invoice", "billing_test_subscription" FROM app_public_ro;
