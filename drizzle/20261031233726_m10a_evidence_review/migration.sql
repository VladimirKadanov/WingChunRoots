-- Generated migration (M10a: evidence, historical teachers and the review queue):
-- - evidence_file.original_name: the uploaded file's own name, cleaned and at most 200 characters,
--   shown only to the people who may download the file; evidence_file.mime is one of the four
--   types the upload accepts by their magic bytes (JPEG, PNG, WebP, PDF; plan §6.4).
-- - review_case: at most one open case (open, in_review, needs_info) of a kind per relationship.
-- - review_note.idempotency_key: a second submit of the same note form adds nothing (plan §5.6).
-- No new table, so no new grant: app_rw already has SELECT, INSERT, UPDATE and DELETE on
-- evidence_file, evidence_link, review_case and review_note, and app_public_ro has none.
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
ALTER TABLE "evidence_file" ADD COLUMN "original_name" text;--> statement-breakpoint
ALTER TABLE "review_note" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "review_case_one_open_per_relationship_key" ON "review_case" ("relationship_id","kind") WHERE "relationship_id" IS NOT NULL AND "status" IN ('open', 'in_review', 'needs_info');--> statement-breakpoint
CREATE UNIQUE INDEX "review_note_idempotency_key" ON "review_note" ("author_user_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_file" ADD CONSTRAINT "evidence_file_mime_check" CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));--> statement-breakpoint
ALTER TABLE "evidence_file" ADD CONSTRAINT "evidence_file_original_name_length" CHECK ("original_name" IS NULL OR char_length("original_name") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "review_note" ADD CONSTRAINT "review_note_idempotency_key_format" CHECK ("idempotency_key" IS NULL OR "idempotency_key" ~ '^[A-Za-z0-9_-]{8,64}$');--> statement-breakpoint
ALTER TABLE "review_note" ADD CONSTRAINT "review_note_body_not_blank" CHECK (btrim("body") <> '');