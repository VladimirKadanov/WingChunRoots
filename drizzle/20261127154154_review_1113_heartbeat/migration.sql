CREATE TABLE "system_heartbeat" (
	"kind" text PRIMARY KEY,
	"started_at" timestamp with time zone NOT NULL,
	"beat_at" timestamp with time zone NOT NULL,
	CONSTRAINT "system_heartbeat_kind_check" CHECK ("kind" IN ('worker'))
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "system_heartbeat" TO app_rw;
