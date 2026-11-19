CREATE TABLE "person_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"person_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_link_position_range" CHECK ("position" BETWEEN 0 AND 4),
	CONSTRAINT "person_link_label_length" CHECK (char_length("label") BETWEEN 1 AND 60),
	CONSTRAINT "person_link_url_https" CHECK ("url" ~ '^https://' AND char_length("url") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "person_link_person_position_key" ON "person_link" ("person_id","position");--> statement-breakpoint
ALTER TABLE "person_link" ADD CONSTRAINT "person_link_person_id_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE;--> statement-breakpoint
-- ADR 0047: the links of a featured profile. The app reads and writes them; the public role never.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "person_link" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "person_link" FROM app_public_ro;
