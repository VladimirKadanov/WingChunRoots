// The graph queries of the lineage API (plan §6.3; milestone M04): ego network, ancestors,
// subtree and routes of descent, in the answer shape of plan §6.3 (src/server/dto/public.ts).
//
// Every query reads only v_public_person and v_public_edge, through the database it is given:
// app_public_ro for every answer (src/server/services/lineage.ts). The signed-in participant's own
// involved_only relationships (DEFAULT D03) arrive separately as `extras` (lineage-viewer.ts):
// they join the walk as a jsonb parameter, are returned with visibility 'involved_only', and never
// enter a count. childCount and hiddenCounts are counted from v_public_edge only (plan §6.2), so a
// pending request never changes what an anonymous visitor sees.
//
// Every function here runs inside readTransaction(), which sets SET LOCAL statement_timeout = '2s'
// first. A walk is capped at NODE_CAP people in breadth-first order; what the cap or the fan-out
// limit leaves out is reported in hiddenCounts (and `truncated`).

import { createHash } from 'node:crypto';

import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '../db';
import type { PublicName, PublicPeriod } from '../db/schema/views';
import type {
  ClaimState,
  LineageEdgeDto,
  LineageGraphDto,
  LineageNodeDto,
  LineagePathDto,
  LineagePathsDto,
  LineageRefDto,
  PeriodDto,
  PublicNameDto,
  RelationshipStatusDto,
  StudentEntryDto,
  StudentsPageDto,
} from '../dto/public';

/** About 500 people per answer (plan §6.3); the rest goes to hiddenCounts. */
export const NODE_CAP = 500;
/** Generations up in an ego network: 16 is every recorded generation in practice. */
export const MAX_UP = 16;
export const MAX_DOWN = 4;
export const MAX_FANOUT = 100;
export const MAX_SUBTREE_DEPTH = 6;
/** Bound of the ancestor and route walks; a deeper record is not expected in Wing Chun. */
export const ANCESTOR_DEPTH = 32;
export const MAX_PATHS = 200;
/** Complete routes counted for "N more routes". */
export const PATHS_COUNT_CAP = 1000;
export const DESCENDANTS_CAP = 10_000;

// --- Execution -------------------------------------------------------------------------------

/** What a query needs from a database or a transaction. */
export interface Executor {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
}

async function rows<T>(ex: Executor, query: SQL): Promise<T[]> {
  return (await ex.execute(query)).rows as T[];
}

/**
 * Runs `fn` in a read-only, repeatable-read transaction (one snapshot for all of an answer's
 * queries) whose first statement is SET LOCAL statement_timeout = '2s' (plan §6.3).
 */
export async function readTransaction<T>(db: Database, fn: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction(
    async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
      return fn(tx);
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/** A uuid[] parameter. The ids are bound as one text value and cast by PostgreSQL. */
function uuids(ids: readonly string[]): SQL {
  return sql`${`{${ids.join(',')}}`}::uuid[]`;
}

// --- The signed-in participant's own relationships (DEFAULT D03) ----------------------------

export interface OwnEdge {
  id: string;
  teacherId: string;
  studentId: string;
  lineage: LineageRefDto;
  status: RelationshipStatusDto;
  isDisplayPrimary: boolean;
  periods: PublicPeriod[];
}

export interface OwnNode {
  id: string;
  slug: string;
  displayName: string;
  altNames: PublicNameDto[];
  kind: string;
  lifeStatus: string;
  stewardship: string;
  countryCode: string | null;
  cityName: string | null;
  bio: string | null;
}

/**
 * The viewer's own involved_only relationships and the people at their ends that the public
 * views leave out. Built per request from app_rw (lineage-viewer.ts), never cached.
 */
export interface ViewerExtras {
  /** The person the signed-in account claimed, if any. */
  personId: string | null;
  edges: OwnEdge[];
  /** Hidden people the viewer may see: their own person and the other end of each own edge. */
  nodes: Record<string, OwnNode>;
}

export const NO_EXTRAS: ViewerExtras = { personId: null, edges: [], nodes: {} };

/** The extra edges as a CTE `extra(id, teacher_id, student_id, lineage_id)`. */
function extraCte(extras: ViewerExtras): SQL {
  const list = extras.edges.map((e) => ({ id: e.id, teacher_id: e.teacherId, student_id: e.studentId, lineage_id: e.lineage.id }));
  return sql`extra AS (
    SELECT x.id, x.teacher_id, x.student_id, x.lineage_id
      FROM jsonb_to_recordset(${JSON.stringify(list)}::jsonb) AS x(id uuid, teacher_id uuid, student_id uuid, lineage_id uuid)
  )`;
}

// --- Node sets --------------------------------------------------------------------------------

/**
 * Ego network: `up` generations of teachers and `down` generations of students, at most
 * `fanout` students per person (own requests first, then by name). Breadth-first order: by
 * generation, teachers before students of the same generation, then by id; at most
 * NODE_CAP + 1 people. The students are read one generation per query and the walk stops once
 * the cap is reached: a single recursive query explores every student to the full depth before
 * it can cut, which grows with the width of the lineage (docs/perf/api.md).
 */
export async function egoNodeIds(
  ex: Executor,
  input: { focusId: string; up: number; down: number; fanoutLimit: number },
  extras: ViewerExtras,
): Promise<string[]> {
  const teachers = await rows<{ id: string; depth: number }>(
    ex,
    sql`
WITH RECURSIVE ${extraCte(extras)},
up(id, depth) AS (
  SELECT ${input.focusId}::uuid, 0
  UNION
  SELECT e.teacher_id, up.depth + 1
    FROM up
    CROSS JOIN LATERAL (
      SELECT pe.teacher_person_id AS teacher_id FROM v_public_edge pe WHERE pe.student_person_id = up.id
      UNION ALL
      SELECT x.teacher_id FROM extra x WHERE x.student_id = up.id
    ) e
   WHERE up.depth < ${input.up}::int
)
SELECT id::text AS id, min(depth)::int AS depth FROM up GROUP BY id ORDER BY min(depth), id LIMIT ${NODE_CAP + 1}`,
  );
  // Each person once, at their nearest generation; dir 0 = teacher side, 1 = student side.
  const place = new Map<string, { depth: number; dir: number }>();
  for (const t of teachers) place.set(t.id, { depth: t.depth, dir: 0 });
  place.set(input.focusId, { depth: 0, dir: 0 });

  const reached = [input.focusId];
  let frontier = [input.focusId];
  for (let generation = 1; generation <= input.down && frontier.length > 0; generation += 1) {
    // Everyone who sorts before this generation's students: nearer people, and its teachers.
    let before = 0;
    for (const p of place.values()) if (p.depth < generation || (p.depth === generation && p.dir === 0)) before += 1;
    if (before > NODE_CAP) break;
    const next = await rows<{ id: string }>(
      ex,
      sql`
WITH ${extraCte(extras)}
SELECT c.student_id::text AS id
  FROM unnest(${uuids(frontier)}) AS t(id)
  CROSS JOIN LATERAL (
    SELECT s.student_id FROM (
      -- The name per row through the primary key: a join let the planner hash all of
      -- v_public_person (docs/perf/api.md).
      SELECT pe.student_person_id AS student_id, 1 AS rank,
             (SELECT vp.display_name FROM v_public_person vp WHERE vp.id = pe.student_person_id) AS name
        FROM v_public_edge pe
       WHERE pe.teacher_person_id = t.id
      UNION ALL
      SELECT x.student_id, 0, '' FROM extra x WHERE x.teacher_id = t.id
    ) s
    GROUP BY s.student_id
    ORDER BY min(s.rank), min(s.name), s.student_id
    LIMIT ${input.fanoutLimit}::int
  ) c
 WHERE c.student_id <> ALL(${uuids(reached)})
 GROUP BY c.student_id
 ORDER BY c.student_id
 LIMIT ${NODE_CAP + 1 - before}`,
    );
    frontier = next.map((r) => r.id);
    reached.push(...frontier);
    for (const id of frontier) if (!place.has(id)) place.set(id, { depth: generation, dir: 1 });
  }

  return [...place.entries()]
    .sort(([a, pa], [b, pb]) => pa.depth - pb.depth || pa.dir - pb.dir || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, NODE_CAP + 1)
    .map(([id]) => id);
}

/** Every ancestor (each once), nearest first. */
export async function ancestorNodeIds(ex: Executor, focusId: string, extras: ViewerExtras): Promise<string[]> {
  const result = await rows<{ id: string }>(
    ex,
    sql`
WITH RECURSIVE ${extraCte(extras)},
up(id, depth) AS (
  SELECT ${focusId}::uuid, 0
  UNION
  SELECT e.teacher_id, up.depth + 1
    FROM up
    CROSS JOIN LATERAL (
      SELECT pe.teacher_person_id AS teacher_id FROM v_public_edge pe WHERE pe.student_person_id = up.id
      UNION ALL
      SELECT x.teacher_id FROM extra x WHERE x.student_id = up.id
    ) e
   WHERE up.depth < ${ANCESTOR_DEPTH}::int
)
SELECT id::text AS id FROM up GROUP BY id ORDER BY min(depth), id LIMIT ${NODE_CAP + 1}`,
  );
  return result.map((r) => r.id);
}

/**
 * Descendants of `rootId` to `depth` generations, optionally along one lineage only: generation
 * by generation, each ordered by id, until NODE_CAP + 1 people (the same set as ordering all
 * descendants by generation, then id). One query per generation, so the walk never goes past
 * the cap: a single recursive query explores every descendant to the full depth before it can
 * cut, which took 0.7 s at depth 6 on the 100,000-relationship graph of docs/perf/api.md.
 */
export async function subtreeNodeIds(
  ex: Executor,
  input: { rootId: string; lineageId: string | null; depth: number },
  extras: ViewerExtras,
): Promise<string[]> {
  const lineage = input.lineageId;
  const seen = [input.rootId];
  let frontier = [input.rootId];
  for (let generation = 1; generation <= input.depth && frontier.length > 0 && seen.length <= NODE_CAP; generation += 1) {
    const next = await rows<{ id: string }>(
      ex,
      sql`
WITH ${extraCte(extras)}
SELECT c.student_id::text AS id
  FROM (
    SELECT pe.student_person_id AS student_id FROM v_public_edge pe
     WHERE pe.teacher_person_id = ANY(${uuids(frontier)}) AND (${lineage}::uuid IS NULL OR pe.lineage_id = ${lineage}::uuid)
    UNION ALL
    SELECT x.student_id FROM extra x
     WHERE x.teacher_id = ANY(${uuids(frontier)}) AND (${lineage}::uuid IS NULL OR x.lineage_id = ${lineage}::uuid)
  ) c
 WHERE c.student_id <> ALL(${uuids(seen)})
 GROUP BY c.student_id
 ORDER BY c.student_id
 LIMIT ${NODE_CAP + 1 - seen.length}`,
    );
    frontier = next.map((r) => r.id);
    seen.push(...frontier);
  }
  return seen;
}

/**
 * Complete routes from `focusId` up to a person without recorded teachers, as the CYCLE clause
 * walks them (shorter first), at most PATHS_COUNT_CAP + 1. Each route runs focus → top.
 */
async function routesUp(ex: Executor, focusId: string, extras: ViewerExtras): Promise<{ nodes: string[]; edges: string[] }[]> {
  return rows<{ nodes: string[]; edges: string[] }>(
    ex,
    sql`
WITH RECURSIVE ${extraCte(extras)},
p(id, nodes, edges, depth) AS (
  SELECT ${focusId}::uuid, ARRAY[${focusId}::uuid], ARRAY[]::uuid[], 0
  UNION ALL
  SELECT e.teacher_id, p.nodes || e.teacher_id, p.edges || e.edge_id, p.depth + 1
    FROM p
    CROSS JOIN LATERAL (
      SELECT pe.teacher_person_id AS teacher_id, pe.id AS edge_id FROM v_public_edge pe WHERE pe.student_person_id = p.id
      UNION ALL
      SELECT x.teacher_id, x.id FROM extra x WHERE x.student_id = p.id
    ) e
   WHERE p.depth < ${ANCESTOR_DEPTH}::int
) CYCLE id SET is_cycle USING cycle_path
SELECT p.nodes::text[] AS nodes, p.edges::text[] AS edges
  FROM p
 WHERE NOT p.is_cycle AND p.depth > 0
   -- Scalar subqueries, not NOT EXISTS: the planner turned that into a hash anti-join over all
   -- of v_public_edge (docs/perf/api.md); these stay index lookups per route end.
   AND (SELECT pe.id FROM v_public_edge pe WHERE pe.student_person_id = p.id LIMIT 1) IS NULL
   AND (SELECT x.id FROM extra x WHERE x.student_id = p.id LIMIT 1) IS NULL
 LIMIT ${PATHS_COUNT_CAP + 1}`,
  );
}

// --- Assembly ---------------------------------------------------------------------------------

interface PersonRow {
  id: string;
  slug: string;
  life_status: string;
  stewardship: string;
  display_name: string;
  alt_names: PublicName[];
}

interface EdgeRow {
  id: string;
  teacher_id: string;
  student_id: string;
  lineage_id: string;
  status: RelationshipStatusDto;
  is_display_primary: boolean;
  periods: PublicPeriod[];
  lineage_slug: string;
  lineage_name: string;
  lineage_root_person_id: string | null;
}

interface CountRow {
  id: string;
  teachers: number;
  students: number;
  lineage_ids: string[];
}

export function claimStateOf(stewardship: string): ClaimState {
  return stewardship === 'self' ? 'claimed' : stewardship === 'platform' ? 'platform' : 'unclaimed';
}

function datePrefix(date: string | null, precision: string): string | null {
  if (!date || precision === 'unknown') return null;
  if (precision === 'year') return date.slice(0, 4);
  if (precision === 'month') return date.slice(0, 7);
  return date.slice(0, 10);
}

export function periodsOf(periods: readonly PublicPeriod[]): PeriodDto[] {
  return periods.map((p) => ({
    from: datePrefix(p.startsOn, p.precision),
    to: datePrefix(p.endsOn, p.precision),
    ongoing: p.ongoing,
    precision: p.precision as PeriodDto['precision'],
  }));
}

/** Every period has ended: none is ongoing and at least one has an end. */
export function isHistorical(periods: readonly PeriodDto[]): boolean {
  return periods.length > 0 && periods.every((p) => !p.ongoing) && periods.some((p) => p.to !== null);
}

export function namesOf(names: readonly PublicName[]): PublicNameDto[] {
  return names.map((n) => ({ value: n.value, script: n.script, lang: n.lang, kind: n.kind, romanization: n.romanization ?? null }));
}

/** Public people among `ids`. */
async function publicPeople(ex: Executor, ids: readonly string[]): Promise<Map<string, PersonRow>> {
  if (ids.length === 0) return new Map();
  const list = await rows<PersonRow>(
    ex,
    sql`SELECT id::text AS id, slug, life_status, stewardship, display_name, alt_names
          FROM v_public_person WHERE id = ANY(${uuids(ids)})`,
  );
  return new Map(list.map((p) => [p.id, p]));
}

/** True when v_public_person shows this person. */
export async function isPublicPerson(ex: Executor, personId: string): Promise<boolean> {
  const list = await rows(ex, sql`SELECT 1 FROM v_public_person WHERE id = ${personId}::uuid`);
  return list.length > 0;
}

/**
 * Counts from v_public_edge only (plan §6.2): public teachers, students and lineages. Each public
 * edge touching a person is read once from each end, by index (docs/perf/api.md).
 */
async function publicCounts(ex: Executor, ids: readonly string[]): Promise<Map<string, CountRow>> {
  if (ids.length === 0) return new Map();
  const list = await rows<CountRow>(
    ex,
    sql`
SELECT n.id::text AS id, up.teachers, down.students,
       ARRAY(SELECT DISTINCT l.id::text FROM unnest(up.lineages || down.lineages) AS l(id) ORDER BY 1) AS lineage_ids
  FROM unnest(${uuids(ids)}) AS n(id)
 CROSS JOIN LATERAL (
       SELECT count(DISTINCT e.teacher_person_id)::int AS teachers, COALESCE(array_agg(e.lineage_id), '{}') AS lineages
         FROM v_public_edge e WHERE e.student_person_id = n.id) up
 CROSS JOIN LATERAL (
       SELECT count(DISTINCT e.student_person_id)::int AS students, COALESCE(array_agg(e.lineage_id), '{}') AS lineages
         FROM v_public_edge e WHERE e.teacher_person_id = n.id) down`,
  );
  return new Map(list.map((c) => [c.id, c]));
}

/** For each student, the id and lineage of the edge drawn as primary (DEFAULT D05). */
async function primaryEdges(
  ex: Executor,
  studentIds: readonly string[],
  extras: ViewerExtras,
): Promise<Map<string, { id: string; lineageId: string }>> {
  const primary = new Map<string, { id: string; lineageId: string }>();
  if (studentIds.length === 0) return primary;
  const list = await rows<{ student_id: string; id: string; lineage_id: string; is_display_primary: boolean }>(
    ex,
    sql`SELECT student_person_id::text AS student_id, id::text AS id, lineage_id::text AS lineage_id, is_display_primary
          FROM v_public_edge WHERE student_person_id = ANY(${uuids(studentIds)})
         ORDER BY student_person_id, created_at, id`,
  );
  const byStudent = new Map<string, typeof list>();
  for (const e of list) byStudent.set(e.student_id, [...(byStudent.get(e.student_id) ?? []), e]);
  for (const [studentId, edges] of byStudent) {
    const chosen = edges.find((e) => e.is_display_primary) ?? edges[0]!;
    primary.set(studentId, { id: chosen.id, lineageId: chosen.lineage_id });
  }
  // A student with no public teacher: the earliest own edge is drawn as primary.
  for (const e of extras.edges) {
    if (studentIds.includes(e.studentId) && !primary.has(e.studentId)) primary.set(e.studentId, { id: e.id, lineageId: e.lineage.id });
  }
  return primary;
}

/** Lineage refs for ids that no edge of the answer named. */
async function lineageRefs(ex: Executor, ids: readonly string[]): Promise<LineageRefDto[]> {
  if (ids.length === 0) return [];
  const list = await rows<{ id: string; slug: string; name: string; root: string | null }>(
    ex,
    sql`SELECT l.id::text AS id, x.lineage_slug AS slug, x.lineage_name AS name, x.lineage_root_person_id::text AS root
          FROM unnest(${uuids(ids)}) AS l(id)
          CROSS JOIN LATERAL (
            SELECT e.lineage_slug, e.lineage_name, e.lineage_root_person_id
              FROM v_public_edge e WHERE e.lineage_id = l.id LIMIT 1) x`,
  );
  return list.map((l) => ({ id: l.id, slug: l.slug, name: l.name, rootPersonId: l.root }));
}

export function dataVersionOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

interface AssembleOptions {
  focusId: string | null;
  /** Edges only of this lineage (subtree with lineageId). */
  lineageId?: string | null;
  /** Only these edges (routes); otherwise every edge between two people of the answer. */
  edgeIds?: ReadonlySet<string>;
}

/**
 * The answer for `orderedIds` (breadth-first order, at most NODE_CAP + 1): people, the edges
 * between them, counts and hiddenCounts from v_public_edge, and the lineages named.
 */
export async function assembleGraph(
  ex: Executor,
  orderedIds: readonly string[],
  extras: ViewerExtras,
  options: AssembleOptions,
): Promise<LineageGraphDto> {
  const truncated = orderedIds.length > NODE_CAP;
  const candidates = orderedIds.slice(0, NODE_CAP);
  const people = await publicPeople(ex, candidates);
  // Hidden people appear only when they are the viewer's own or at the other end of an own edge.
  const ids = candidates.filter((id) => people.has(id) || extras.nodes[id] !== undefined);
  const inView = new Set(ids);

  const lineageFilter = options.lineageId ?? null;
  const publicEdges =
    ids.length === 0
      ? []
      : await rows<EdgeRow>(
          ex,
          sql`SELECT id::text AS id, teacher_person_id::text AS teacher_id, student_person_id::text AS student_id,
                     lineage_id::text AS lineage_id, status, is_display_primary, periods,
                     lineage_slug, lineage_name, lineage_root_person_id::text AS lineage_root_person_id
                FROM v_public_edge
               WHERE student_person_id = ANY(${uuids(ids)}) AND teacher_person_id = ANY(${uuids(ids)})
                 AND (${lineageFilter}::uuid IS NULL OR lineage_id = ${lineageFilter}::uuid)
               ORDER BY created_at, id`,
        );
  const keep = (id: string) => options.edgeIds === undefined || options.edgeIds.has(id);
  const ownEdges = extras.edges.filter(
    (e) =>
      inView.has(e.teacherId) &&
      inView.has(e.studentId) &&
      (lineageFilter === null || e.lineage.id === lineageFilter) &&
      keep(e.id),
  );
  const shownPublic = publicEdges.filter((e) => keep(e.id));

  const studentIds = [...new Set([...shownPublic.map((e) => e.student_id), ...ownEdges.map((e) => e.studentId)])];
  // In sequence: both run on the transaction's one connection, which takes one query at a time.
  const counts = await publicCounts(ex, ids);
  const primary = await primaryEdges(ex, studentIds, extras);
  const kindOf = (edgeId: string, studentId: string, lineageId: string): LineageEdgeDto['kind'] => {
    const p = primary.get(studentId);
    if (!p || p.id === edgeId) return 'primary';
    return p.lineageId === lineageId ? 'converging' : 'crossLineage';
  };

  const edges: LineageEdgeDto[] = [
    ...shownPublic.map((e) => ({
      id: e.id,
      teacherId: e.teacher_id,
      studentId: e.student_id,
      lineageId: e.lineage_id,
      kind: kindOf(e.id, e.student_id, e.lineage_id),
      status: e.status,
      isDisplayPrimary: e.is_display_primary,
      visibility: 'public' as const,
      periods: periodsOf(e.periods),
    })),
    ...ownEdges.map((e) => ({
      id: e.id,
      teacherId: e.teacherId,
      studentId: e.studentId,
      lineageId: e.lineage.id,
      kind: kindOf(e.id, e.studentId, e.lineage.id),
      status: e.status,
      isDisplayPrimary: e.isDisplayPrimary,
      // DEFAULT D03: shown only to the people involved, so marked as such.
      visibility: 'involved_only' as const,
      periods: periodsOf(e.periods),
    })),
  ];

  // Public teachers and students of each person that this answer shows, from public edges only.
  const teachersShown = new Map<string, Set<string>>();
  const studentsShown = new Map<string, Set<string>>();
  for (const e of shownPublic) {
    teachersShown.set(e.student_id, (teachersShown.get(e.student_id) ?? new Set()).add(e.teacher_id));
    studentsShown.set(e.teacher_id, (studentsShown.get(e.teacher_id) ?? new Set()).add(e.student_id));
  }

  const nodes: LineageNodeDto[] = [];
  const hiddenCounts: LineageGraphDto['hiddenCounts'] = {};
  for (const id of ids) {
    const c = counts.get(id) ?? { id, teachers: 0, students: 0, lineage_ids: [] };
    const shownStudents = studentsShown.get(id)?.size ?? 0;
    const hiddenTeachers = Math.max(0, c.teachers - (teachersShown.get(id)?.size ?? 0));
    const hiddenStudents = Math.max(0, c.students - shownStudents);
    if (hiddenTeachers > 0 || hiddenStudents > 0) hiddenCounts[id] = { teachers: hiddenTeachers, students: hiddenStudents };
    const p = people.get(id);
    const own = extras.nodes[id];
    nodes.push({
      id,
      slug: p ? p.slug : own!.slug,
      displayName: p ? p.display_name : own!.displayName,
      altNames: p ? namesOf(p.alt_names) : own!.altNames,
      lifeStatus: p ? p.life_status : own!.lifeStatus,
      claimState: claimStateOf(p ? p.stewardship : own!.stewardship),
      lineageIds: c.lineage_ids,
      childCount: c.students,
      hasMoreChildren: c.students > shownStudents,
      visibility: p ? 'public' : 'involved_only',
    });
  }

  // Lineages named by the edges or by the people of the answer.
  const lineages = new Map<string, LineageRefDto>();
  for (const e of publicEdges) {
    lineages.set(e.lineage_id, { id: e.lineage_id, slug: e.lineage_slug, name: e.lineage_name, rootPersonId: e.lineage_root_person_id });
  }
  for (const e of ownEdges) lineages.set(e.lineage.id, e.lineage);
  const missing = [...new Set(nodes.flatMap((n) => n.lineageIds))].filter((id) => !lineages.has(id));
  for (const l of await lineageRefs(ex, missing)) lineages.set(l.id, l);

  return {
    focusId: options.focusId,
    dataVersion: dataVersionOf({ nodes, edges }),
    nodes,
    edges,
    hiddenCounts,
    lineages: [...lineages.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id)),
    truncated,
  };
}

// --- The four answers -------------------------------------------------------------------------

export async function egoGraph(
  ex: Executor,
  input: { focusId: string; up: number; down: number; fanoutLimit: number },
  extras: ViewerExtras,
): Promise<LineageGraphDto> {
  const ids = await egoNodeIds(ex, input, extras);
  return assembleGraph(ex, ids, extras, { focusId: input.focusId });
}

export async function ancestorsGraph(ex: Executor, focusId: string, extras: ViewerExtras): Promise<LineageGraphDto> {
  const ids = await ancestorNodeIds(ex, focusId, extras);
  return assembleGraph(ex, ids, extras, { focusId });
}

export async function subtreeGraph(
  ex: Executor,
  input: { rootId: string; lineageId: string | null; depth: number },
  extras: ViewerExtras,
): Promise<LineageGraphDto> {
  const ids = await subtreeNodeIds(ex, input, extras);
  return assembleGraph(ex, ids, extras, { focusId: input.rootId, lineageId: input.lineageId });
}

/**
 * Routes of descent: complete routes from the earliest recorded teacher down to `focusId`, the
 * route along display-primary teachers first (DEFAULT D05), then shorter ones, then by name.
 * Returns at most `limit` routes whose people fit in NODE_CAP, with the edges on them only.
 */
export async function pathsGraph(
  ex: Executor,
  input: { focusId: string; limit: number },
  extras: ViewerExtras,
): Promise<LineagePathsDto> {
  const found = await routesUp(ex, input.focusId, extras);
  const totalPathsCapped = found.length > PATHS_COUNT_CAP;
  const routes: LineagePathDto[] = found
    .slice(0, PATHS_COUNT_CAP)
    .map((r) => ({ personIds: [...r.nodes].reverse(), edgeIds: [...r.edges].reverse() }));

  // Sort keys: edges that are not the student's primary edge, length, then the names on the way.
  const everyone = [...new Set(routes.flatMap((r) => r.personIds))];
  const people = await publicPeople(ex, everyone);
  const primary = await primaryEdges(ex, everyone, extras);
  const nameOf = (id: string) => people.get(id)?.display_name ?? extras.nodes[id]?.displayName ?? '';
  const keyOf = (r: LineagePathDto) => ({
    secondary: r.edgeIds.filter((edgeId, i) => primary.get(r.personIds[i + 1]!)?.id !== edgeId).length,
    length: r.edgeIds.length,
    names: r.personIds.map(nameOf).join('\u0000'),
  });
  const keyed = routes.map((r) => ({ r, k: keyOf(r) }));
  keyed.sort((a, b) => a.k.secondary - b.k.secondary || a.k.length - b.k.length || a.k.names.localeCompare(b.k.names, 'en'));

  const chosen: LineagePathDto[] = [];
  const order: string[] = [input.focusId];
  const seen = new Set(order);
  for (const { r } of keyed) {
    if (chosen.length >= input.limit) break;
    const added = r.personIds.filter((id) => !seen.has(id));
    if (seen.size + new Set(added).size > NODE_CAP) break;
    chosen.push(r);
    for (const id of r.personIds) {
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }
  const graph = await assembleGraph(ex, order, extras, {
    focusId: input.focusId,
    edgeIds: new Set(chosen.flatMap((r) => r.edgeIds)),
  });
  // A route through someone the viewer may not see cannot be shown (a hidden person is only
  // ever reached through the viewer's own edge, so this keeps every route).
  const shown = new Set(graph.nodes.map((n) => n.id));
  const paths = chosen.filter((r) => r.personIds.every((id) => shown.has(id)));
  return {
    ...graph,
    truncated: graph.truncated || paths.length < Math.min(input.limit, routes.length),
    paths,
    totalPaths: routes.length,
    totalPathsCapped,
  };
}

// --- People -----------------------------------------------------------------------------------

/** The id of the public person with this slug, or null. */
export async function publicPersonIdBySlug(ex: Executor, slug: string): Promise<string | null> {
  const list = await rows<{ id: string }>(ex, sql`SELECT id::text AS id FROM v_public_person WHERE slug = ${slug}`);
  return list[0]?.id ?? null;
}

export interface ProfileRow {
  id: string;
  slug: string;
  kind: string;
  life_status: string;
  stewardship: string;
  country_code: string | null;
  city_name: string | null;
  display_name: string;
  alt_names: PublicName[];
  bio: string | null;
}

export async function publicProfileRow(ex: Executor, personId: string): Promise<ProfileRow | null> {
  const list = await rows<ProfileRow>(
    ex,
    sql`SELECT id::text AS id, slug, kind, life_status, stewardship, country_code, city_name, display_name, alt_names, bio
          FROM v_public_person WHERE id = ${personId}::uuid`,
  );
  return list[0] ?? null;
}

/** Public teachers, students and descendants (distinct, up to DESCENDANTS_CAP) and lineages. */
export async function personCounts(
  ex: Executor,
  personId: string,
): Promise<{ teachers: number; students: number; descendants: number; descendantsCapped: boolean; lineageIds: string[] }> {
  const [count] = [...(await publicCounts(ex, [personId])).values()];
  const [d] = await rows<{ n: number }>(
    ex,
    sql`
WITH RECURSIVE d(id) AS (
  SELECT ${personId}::uuid
  UNION
  SELECT pe.student_person_id FROM d JOIN v_public_edge pe ON pe.teacher_person_id = d.id
)
SELECT (count(*) - 1)::int AS n FROM (SELECT id FROM d LIMIT ${DESCENDANTS_CAP + 2}) x`,
  );
  const descendants = d?.n ?? 0;
  return {
    teachers: count?.teachers ?? 0,
    students: count?.students ?? 0,
    descendants: Math.min(descendants, DESCENDANTS_CAP),
    descendantsCapped: descendants > DESCENDANTS_CAP,
    lineageIds: count?.lineage_ids ?? [],
  };
}

export { lineageRefs };

interface StudentRow {
  id: string;
  slug: string;
  display_name: string;
  alt_names: PublicName[];
  life_status: string;
  stewardship: string;
  edges: (Omit<EdgeRow, 'teacher_id' | 'student_id'> & { periods: PublicPeriod[] })[];
  historical: boolean;
}

/** A teacher's public students, one row per student with their edges to this teacher. */
function studentsCte(teacherId: string): SQL {
  return sql`s AS (
  SELECT vp.id, vp.slug, vp.display_name, vp.alt_names, vp.life_status, vp.stewardship,
         jsonb_agg(jsonb_build_object(
           'id', pe.id, 'lineage_id', pe.lineage_id, 'status', pe.status,
           'is_display_primary', pe.is_display_primary, 'periods', pe.periods,
           'lineage_slug', pe.lineage_slug, 'lineage_name', pe.lineage_name,
           'lineage_root_person_id', pe.lineage_root_person_id) ORDER BY pe.created_at, pe.id) AS edges,
         bool_and(
           jsonb_array_length(pe.periods) > 0
           AND NOT jsonb_path_exists(pe.periods, '$[*] ? (@.ongoing == true)')
           AND jsonb_path_exists(pe.periods, '$[*] ? (@.endsOn != null)')) AS historical
    FROM v_public_edge pe
    JOIN v_public_person vp ON vp.id = pe.student_person_id
   WHERE pe.teacher_person_id = ${teacherId}::uuid
   GROUP BY vp.id, vp.slug, vp.display_name, vp.alt_names, vp.life_status, vp.stewardship
)`;
}

/**
 * One page of a teacher's public students: those with a current relationship first, then those
 * whose training has ended (every period ended), each group by name.
 */
export async function studentRows(
  ex: Executor,
  teacherId: string,
  page: number,
  pageSize: number,
): Promise<{ rows: StudentRow[]; activeTotal: number; historicalTotal: number }> {
  const [totals] = await rows<{ active_total: number; historical_total: number }>(
    ex,
    sql`WITH ${studentsCte(teacherId)}
        SELECT (count(*) FILTER (WHERE NOT s.historical))::int AS active_total,
               (count(*) FILTER (WHERE s.historical))::int AS historical_total
          FROM s`,
  );
  const list = await rows<StudentRow>(
    ex,
    sql`WITH ${studentsCte(teacherId)}
        SELECT s.id::text AS id, s.slug, s.display_name, s.alt_names, s.life_status, s.stewardship, s.edges, s.historical
          FROM s
         ORDER BY s.historical, s.display_name, s.id
         LIMIT ${pageSize}::int OFFSET ${(page - 1) * pageSize}::int`,
  );
  return { rows: list, activeTotal: totals?.active_total ?? 0, historicalTotal: totals?.historical_total ?? 0 };
}

export const STUDENTS_PAGE_SIZE = 50;

/**
 * A page of a teacher's students (plan §4.10): public students, active then historical, and on
 * page 1 the signed-in teacher's own requests (`own`, involved_only, never counted).
 */
export async function studentPage(ex: Executor, teacherId: string, page: number, extras: ViewerExtras): Promise<StudentsPageDto> {
  const { rows: list, activeTotal, historicalTotal } = await studentRows(ex, teacherId, page, STUDENTS_PAGE_SIZE);
  const lineages = new Map<string, LineageRefDto>();
  const entries: StudentEntryDto[] = list.map((s) => {
    const edges = s.edges.map((e) => {
      lineages.set(e.lineage_id, { id: e.lineage_id, slug: e.lineage_slug, name: e.lineage_name, rootPersonId: e.lineage_root_person_id });
      return {
        id: e.id,
        lineageId: e.lineage_id,
        status: e.status,
        isDisplayPrimary: e.is_display_primary,
        visibility: 'public' as const,
        periods: periodsOf(e.periods),
      };
    });
    return {
      person: {
        id: s.id,
        slug: s.slug,
        displayName: s.display_name,
        altNames: namesOf(s.alt_names),
        lifeStatus: s.life_status,
        claimState: claimStateOf(s.stewardship),
        visibility: 'public' as const,
      },
      edges,
      historical: s.historical,
    };
  });

  const own: StudentEntryDto[] = [];
  if (page === 1) {
    const ownStudents = extras.edges.filter((e) => e.teacherId === teacherId);
    const people = await publicPeople(ex, ownStudents.map((e) => e.studentId));
    for (const e of ownStudents) {
      const p = people.get(e.studentId);
      const n = extras.nodes[e.studentId];
      if (!p && !n) continue;
      lineages.set(e.lineage.id, e.lineage);
      own.push({
        person: {
          id: e.studentId,
          slug: p ? p.slug : n!.slug,
          displayName: p ? p.display_name : n!.displayName,
          altNames: p ? namesOf(p.alt_names) : n!.altNames,
          lifeStatus: p ? p.life_status : n!.lifeStatus,
          claimState: claimStateOf(p ? p.stewardship : n!.stewardship),
          visibility: p ? 'public' : 'involved_only',
        },
        edges: [
          {
            id: e.id,
            lineageId: e.lineage.id,
            status: e.status,
            isDisplayPrimary: e.isDisplayPrimary,
            visibility: 'involved_only',
            periods: periodsOf(e.periods),
          },
        ],
        historical: false,
      });
    }
  }

  return {
    personId: teacherId,
    page,
    pageSize: STUDENTS_PAGE_SIZE,
    activeTotal,
    historicalTotal,
    pageCount: Math.max(1, Math.ceil((activeTotal + historicalTotal) / STUDENTS_PAGE_SIZE)),
    active: entries.filter((e) => !e.historical),
    historical: entries.filter((e) => e.historical),
    own,
    lineages: [...lineages.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id)),
  };
}
