-- Generated migration (M07: names, profile and search):
-- - person_name_key.source: how each search key was made (the name itself, a transliteration
--   library, the Bulgarian Streamlined System, the Hong Kong spelling table; docs/search.md).
-- - person_name_key_not_blank: a key is never empty.
-- - key_kind gains 'alias' (Hong Kong spellings of Jyutping, src/server/search/aliases.ts).
-- The keys are read by the search service with app_rw and always through v_public_person, so
-- app_public_ro keeps exactly its three views (plan §6.2).
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
ALTER TABLE "person_name_key" ADD COLUMN "source" text DEFAULT 'name' NOT NULL;--> statement-breakpoint
ALTER TABLE "person_name_key" ADD CONSTRAINT "person_name_key_not_blank" CHECK ("key" <> '');--> statement-breakpoint
ALTER TABLE "person_name_key" DROP CONSTRAINT "person_name_key_kind_check", ADD CONSTRAINT "person_name_key_kind_check" CHECK ("key_kind" IN ('latin', 'jyutping', 'pinyin', 'han', 'cyrillic', 'alias'));