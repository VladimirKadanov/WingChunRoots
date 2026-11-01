-- The ancestor paths of the verified lineage as one line, `<pairs> <md5>` (milestone M12):
-- every (ancestor, descendant) pair reachable over verified and in_arbitration edges, the
-- statuses the cycle check walks (src/server/services/relationships.ts). scripts/backup-local.sh
-- writes it beside a dump (<dump>.lineage); scripts/restore-drill.sh computes it again on the
-- restored copy and compares. Ids only, never a name. UNION ends the walk even on bad data.
-- SQL compatible with PostgreSQL 16+ (plan §3.2).
WITH RECURSIVE edge AS (
  SELECT DISTINCT teacher_person_id AS teacher, student_person_id AS student
    FROM teaching_relationship
   WHERE status IN ('verified', 'in_arbitration')
), walk (ancestor, person) AS (
  SELECT teacher, student FROM edge
  UNION
  SELECT w.ancestor, e.student FROM walk w JOIN edge e ON e.teacher = w.person
)
SELECT count(*) || ' ' || md5(coalesce(string_agg(ancestor::text || '>' || person::text, ',' ORDER BY ancestor, person), ''))
  FROM walk;
