-- Generated migration (journey review 2026-11-26, P2-1; docs/adr/0079-beginner-and-teacher-steps.md):
-- person.new_to_wing_chun: the member said "I'm new to Wing Chun" at onboarding; private (no view
-- selects it). The dashboard keeps a beginner's steps until a teacher is named.
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
ALTER TABLE "person" ADD COLUMN "new_to_wing_chun" boolean DEFAULT false NOT NULL;
