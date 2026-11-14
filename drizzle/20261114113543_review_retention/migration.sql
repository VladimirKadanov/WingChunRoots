-- Generated migration with custom SQL (review 2026-11, retention and withdrawal;
-- docs/adr/0032-retention-and-withdrawal.md; DEFAULT review-2026-11,
-- docs/plan/questions/review-2026-11-retention.md):
-- - trial_inquiry: the sender can withdraw an open request (status `withdrawn`), and an open request
--   nobody answered is closed after 90 days: both scrub the sender's name, contact, times, message
--   and the reply (scrubbed_at). sender_name and contact_value may therefore be NULL, but only on a
--   scrubbed row (trial_inquiry_scrub_state).
-- - audit_log stays append-only (UPDATE, DELETE and TRUNCATE are refused for every role), with ONE
--   exception: a change that only sets ip_hmac to NULL. app_rw has no UPDATE privilege on the table,
--   so only null_old_audit_ip_hmac() below (SECURITY DEFINER, owned by migrator) can make it.
-- - record_revision (append-only for app_rw): redact_record_revisions() and redact_person_revisions()
--   replace the text of the two jsonb columns (primaryName, originalName, bio) with
--   "[redacted: N characters]" and mark the object `"redacted": true`. Who, when, which fields,
--   the reason and the case stay. Nothing else of the row is touched.
-- The three functions are granted to app_rw only (EXECUTE is revoked from PUBLIC) and pin their
-- search_path. SQL compatible with PostgreSQL 16+ (plan §3.2).
ALTER TABLE "trial_inquiry" ADD COLUMN "scrubbed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trial_inquiry" ALTER COLUMN "sender_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_inquiry" ALTER COLUMN "contact_value" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_ip_hmac_idx" ON "audit_log" ("occurred_at") WHERE "ip_hmac" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "trial_inquiry_open_created_idx" ON "trial_inquiry" ("created_at") WHERE "status" = 'open';--> statement-breakpoint
ALTER TABLE "trial_inquiry" ADD CONSTRAINT "trial_inquiry_scrub_state" CHECK (("scrubbed_at" IS NULL AND "sender_name" IS NOT NULL AND "contact_value" IS NOT NULL)
        OR ("scrubbed_at" IS NOT NULL AND "status" <> 'open' AND "sender_name" IS NULL AND "contact_value" IS NULL AND "preferred_times" IS NULL AND "message" IS NULL AND "reply" IS NULL));--> statement-breakpoint
ALTER TABLE "trial_inquiry" ADD CONSTRAINT "trial_inquiry_withdrawn_scrubbed" CHECK ("status" <> 'withdrawn' OR "scrubbed_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "trial_inquiry" DROP CONSTRAINT "trial_inquiry_status_check", ADD CONSTRAINT "trial_inquiry_status_check" CHECK ("status" IN ('open', 'answered', 'declined', 'closed', 'withdrawn'));

--> statement-breakpoint
-- The audit log refuses every change but the removal of ip_hmac. TG_OP is tested first because the
-- same function serves the TRUNCATE trigger, where OLD and NEW do not exist.
CREATE OR REPLACE FUNCTION "audit_log_refuse_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ip_hmac IS NOT NULL AND NEW.ip_hmac IS NULL
       AND (to_jsonb(NEW) - 'ip_hmac') = (to_jsonb(OLD) - 'ip_hmac') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
-- Sets ip_hmac to NULL on at most max_rows audit rows older than the cutoff (oldest first); returns
-- how many. The cutoff must be at least 30 days in the past, so a caller cannot erase the recent
-- trail. Rows another transaction holds are skipped.
CREATE FUNCTION "null_old_audit_ip_hmac"(cutoff timestamptz, max_rows integer DEFAULT 1000) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed integer;
BEGIN
  IF cutoff IS NULL OR cutoff > now() - interval '30 days' THEN
    RAISE EXCEPTION 'the cutoff must be at least 30 days in the past' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF max_rows IS NULL OR max_rows < 1 THEN
    RAISE EXCEPTION 'max_rows must be a positive integer' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  WITH picked AS (
    SELECT id FROM audit_log
     WHERE ip_hmac IS NOT NULL AND occurred_at < cutoff
     ORDER BY occurred_at, id
     LIMIT max_rows
       FOR UPDATE SKIP LOCKED)
  UPDATE audit_log a SET ip_hmac = NULL FROM picked WHERE a.id = picked.id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;
--> statement-breakpoint
-- The text of a record's fields (RecordFields in src/server/db/schema/governance.ts) without the text.
CREATE FUNCTION "record_fields_redacted"(fields jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN jsonb_typeof(fields) <> 'object' THEN fields ELSE
    (SELECT coalesce(jsonb_object_agg(
              e.key,
              CASE WHEN e.key IN ('primaryName', 'originalName', 'bio') AND jsonb_typeof(e.value) = 'string'
                   THEN to_jsonb(format('[redacted: %s characters]', char_length(e.value #>> '{}')))
                   ELSE e.value END), '{}'::jsonb)
       FROM jsonb_each(fields) AS e) || jsonb_build_object('redacted', true)
  END
$$;
--> statement-breakpoint
-- Redacts the before and after text of at most max_rows revisions older than the cutoff (the
-- cutoff must be at least 30 days in the past); returns how many. Idempotent: a redacted row is skipped.
CREATE FUNCTION "redact_record_revisions"(cutoff timestamptz, max_rows integer DEFAULT 1000) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed integer;
BEGIN
  IF cutoff IS NULL OR cutoff > now() - interval '30 days' THEN
    RAISE EXCEPTION 'the cutoff must be at least 30 days in the past' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF max_rows IS NULL OR max_rows < 1 THEN
    RAISE EXCEPTION 'max_rows must be a positive integer' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  WITH picked AS (
    SELECT id FROM record_revision
     WHERE created_at < cutoff AND NOT (before ? 'redacted' AND after ? 'redacted')
     ORDER BY created_at, id
     LIMIT max_rows
       FOR UPDATE SKIP LOCKED)
  UPDATE record_revision r
     SET before = record_fields_redacted(r.before), after = record_fields_redacted(r.after)
    FROM picked WHERE r.id = picked.id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;
--> statement-breakpoint
-- Redacts every revision of one record at once (the record was erased or purged); returns how many.
CREATE FUNCTION "redact_person_revisions"(person uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE record_revision r
     SET before = record_fields_redacted(r.before), after = record_fields_redacted(r.after)
   WHERE r.person_id = person AND NOT (r.before ? 'redacted' AND r.after ? 'redacted');
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "null_old_audit_ip_hmac"(timestamptz, integer), "redact_record_revisions"(timestamptz, integer), "redact_person_revisions"(uuid), "record_fields_redacted"(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "null_old_audit_ip_hmac"(timestamptz, integer), "redact_record_revisions"(timestamptz, integer), "redact_person_revisions"(uuid) TO app_rw;
