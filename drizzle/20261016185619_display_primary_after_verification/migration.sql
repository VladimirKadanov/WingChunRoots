-- M01 review: the display preference (DEFAULT D05) belongs to established relationships only.
-- The partial unique index counted requests (pending_teacher, awaiting_claim, under_review), so a
-- private request could take a public student's only display-primary slot and every public edge
-- of that student then showed is_display_primary = false, a hint that a hidden request exists
-- (plan §4.14, D03). Now only verified and in_arbitration relationships compete for the slot, and
-- a CHECK keeps the flag off requests; the verify transition (M09) sets it. revoked keeps its
-- flag as history.
-- Requests seeded before this migration may carry the flag: clear it before the CHECK.
UPDATE "teaching_relationship" SET "is_display_primary" = false
 WHERE "is_display_primary" AND "status" NOT IN ('verified', 'in_arbitration', 'revoked');--> statement-breakpoint
DROP INDEX "teaching_relationship_one_display_primary_key";--> statement-breakpoint
CREATE UNIQUE INDEX "teaching_relationship_one_display_primary_key" ON "teaching_relationship" ("student_person_id") WHERE "is_display_primary" AND "status" IN ('verified', 'in_arbitration');--> statement-breakpoint
ALTER TABLE "teaching_relationship" ADD CONSTRAINT "teaching_relationship_display_primary_after_verification" CHECK (NOT "is_display_primary" OR "status" IN ('verified', 'in_arbitration', 'revoked'));
