CREATE TABLE "organization_claim_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"used_by_user_id" uuid,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_claim_link_status_check" CHECK ("status" IN ('active', 'used', 'revoked')),
	CONSTRAINT "organization_claim_link_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "organization_claim_link_used" CHECK (("status" = 'used') = ("used_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_claim_link_token_hash_key" ON "organization_claim_link" ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_claim_link_one_active_key" ON "organization_claim_link" ("person_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "organization_claim_link_organization_id_idx" ON "organization_claim_link" ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_claim_link_person_id_idx" ON "organization_claim_link" ("person_id");--> statement-breakpoint
CREATE INDEX "organization_claim_link_created_by_user_id_idx" ON "organization_claim_link" ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "organization_claim_link_used_by_user_id_idx" ON "organization_claim_link" ("used_by_user_id");--> statement-breakpoint
ALTER TABLE "organization_claim_link" ADD CONSTRAINT "organization_claim_link_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_claim_link" ADD CONSTRAINT "organization_claim_link_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_claim_link" ADD CONSTRAINT "organization_claim_link_created_by_user_id_auth_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_claim_link" ADD CONSTRAINT "organization_claim_link_used_by_user_id_auth_user_id_fkey" FOREIGN KEY ("used_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
-- ADR 0074: claim links of imported members. The app reads and writes them; the public role never.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "organization_claim_link" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "organization_claim_link" FROM app_public_ro;
