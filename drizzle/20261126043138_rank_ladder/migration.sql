CREATE TABLE "rank_ladder_step" (
	"user_id" uuid,
	"position" integer,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rank_ladder_step_pkey" PRIMARY KEY("user_id","position"),
	CONSTRAINT "rank_ladder_step_position_check" CHECK ("position" BETWEEN 0 AND 29),
	CONSTRAINT "rank_ladder_step_name_length" CHECK (char_length("name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "rank_ladder_step" ADD CONSTRAINT "rank_ladder_step_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
-- ADR 0072: an account's rank ladder. The app reads and writes it; the public role never.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "rank_ladder_step" TO app_rw;--> statement-breakpoint
REVOKE ALL ON TABLE "rank_ladder_step" FROM app_public_ro;
