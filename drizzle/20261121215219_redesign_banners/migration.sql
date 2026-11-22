-- ADR 0052 (docs/adr/0052-public-page-redesign.md): banners and logos for the public pages.
-- - school_photo gets the kind banner, one active per school (school_photo_one_banner_key).
-- - organization_photo: an organization's logo and banner, one active of each, stored like a
--   school's photos (every rendition without metadata). app_rw reads, inserts and updates it;
--   app_public_ro has no right on it.
-- - organization.about: what the organization says about itself, shown on its public page, and
--   v_public_organization gains it as its last column (CREATE OR REPLACE VIEW appends it).
-- SQL compatible with PostgreSQL 16+ (plan §3.2); ids come from the app (UUIDv7).
CREATE TABLE "organization_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"original_sha256" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"full_width" integer,
	"full_height" integer,
	"size_bytes" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"uploaded_by_user_id" uuid,
	"removed_by_user_id" uuid,
	"removed_at" timestamp with time zone,
	"removal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_photo_kind_check" CHECK ("kind" IN ('logo', 'banner')),
	CONSTRAINT "organization_photo_status_check" CHECK ("status" IN ('active', 'replaced', 'removed')),
	CONSTRAINT "organization_photo_storage_key_format" CHECK ("storage_key" ~ '^photos/[0-9a-f]{48}$'),
	CONSTRAINT "organization_photo_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "organization_photo_original_sha256_format" CHECK ("original_sha256" IS NULL OR "original_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "organization_photo_square" CHECK ("width" = "height" AND "width" BETWEEN 96 AND 512),
	CONSTRAINT "organization_photo_full_size" CHECK (("full_width" IS NULL AND "full_height" IS NULL) OR ("full_width" BETWEEN 1 AND 1280 AND "full_height" BETWEEN 1 AND 1280)),
	CONSTRAINT "organization_photo_size_check" CHECK ("size_bytes" > 0),
	CONSTRAINT "organization_photo_removed_has_time" CHECK ("status" <> 'removed' OR "removed_at" IS NOT NULL),
	CONSTRAINT "organization_photo_reason_length" CHECK ("removal_reason" IS NULL OR char_length("removal_reason") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "about" text;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_photo_storage_key_key" ON "organization_photo" ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_photo_one_of_kind_key" ON "organization_photo" ("organization_id","kind") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "organization_photo_uploaded_by_user_id_idx" ON "organization_photo" ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "organization_photo_removed_by_user_id_idx" ON "organization_photo" ("removed_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "school_photo_one_banner_key" ON "school_photo" ("school_id") WHERE "kind" = 'banner' AND "status" = 'active';--> statement-breakpoint
ALTER TABLE "organization_photo" ADD CONSTRAINT "organization_photo_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_photo" ADD CONSTRAINT "organization_photo_uploaded_by_user_id_auth_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_photo" ADD CONSTRAINT "organization_photo_removed_by_user_id_auth_user_id_fkey" FOREIGN KEY ("removed_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_about_length" CHECK ("about" IS NULL OR char_length("about") BETWEEN 1 AND 2000);--> statement-breakpoint
ALTER TABLE "school_photo" DROP CONSTRAINT "school_photo_kind_check", ADD CONSTRAINT "school_photo_kind_check" CHECK ("kind" IN ('logo', 'room', 'banner'));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "organization_photo" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "organization_photo" FROM app_public_ro;--> statement-breakpoint
CREATE OR REPLACE VIEW "v_public_organization" WITH (security_barrier = true) AS
SELECT
  o."id",
  o."slug",
  o."name",
  o."kind",
  o."country_code",
  o."website_url",
  o."approved_at",
  o."created_at",
  o."updated_at",
  o."about"
FROM "organization" o
WHERE o."status" = 'active' AND o."deleted_at" IS NULL;
