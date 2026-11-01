// The fictional lineage graph of the performance scripts (milestone M04, moved here in M13):
// pnpm perf:queries (scripts/perf-queries.ts) and pnpm perf:api (scripts/perf-api.ts) measure the
// same deterministic graph of about 55,000 people and 100,000 teaching relationships (`demo-perf-`
// slugs, uuid keys from the app's UUIDv7; fictional data only, D20).

import { withClient } from '../../src/server/db/admin';
import { uuidv7 } from '../../src/server/db/ids';

/** People per generation: 9 generations, about 55,000 people. */
export const GENERATIONS = [5, 25, 100, 400, 1_500, 4_500, 10_000, 16_000, 22_500];
/** Extra teachers per student beyond the first: 0, 1, 2 or 3, about 0.8 on average. */
export const EXTRA_TEACHERS = [
  [0.45, 0],
  [0.8, 1],
  [0.93, 2],
  [1, 3],
] as const;

/** A small deterministic PRNG (mulberry32), so every run measures the same graph. */
export function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PerfPerson {
  id: string;
  slug: string;
  generation: number;
  lineage: number;
  visibility: 'public' | 'involved_only';
}
export interface PerfEdge {
  id: string;
  teacher: number;
  student: number;
  lineage: number;
  status: string;
  visibility: 'public' | 'involved_only';
  primary: boolean;
  startYear: number;
  endYear: number | null;
}

/** The fictional graph: hubs from a skewed choice of teacher, several teachers per student. */
export function generateGraph() {
  const random = prng(20261018);
  const people: PerfPerson[] = [];
  const byGeneration: number[][] = [];
  let ms = Date.UTC(2026, 9, 18);
  const id = () => uuidv7((ms += 1));
  GENERATIONS.forEach((size, generation) => {
    const members: number[] = [];
    for (let i = 0; i < size; i += 1) {
      const n = people.length;
      members.push(n);
      people.push({
        id: id(),
        slug: `demo-perf-${String(n).padStart(6, '0')}`,
        generation,
        lineage: generation === 0 ? i : -1,
        visibility: generation > 0 && random() < 0.03 ? 'involved_only' : 'public',
      });
    }
    byGeneration.push(members);
  });

  const edges: PerfEdge[] = [];
  const pairs = new Set<string>();
  const pick = (generation: number, skew: number) => {
    const members = byGeneration[generation]!;
    return members[Math.floor(random() ** skew * members.length)]!;
  };
  const addEdge = (teacher: number, student: number, primary: boolean) => {
    const key = `${teacher}:${student}`;
    if (pairs.has(key)) return;
    pairs.add(key);
    const roll = random();
    const [status, visibility] =
      roll < 0.9
        ? (['verified', 'public'] as const)
        : roll < 0.93
          ? (['in_arbitration', 'public'] as const)
          : roll < 0.97
            ? (['pending_teacher', 'involved_only'] as const)
            : roll < 0.99
              ? (['under_review', 'involved_only'] as const)
              : (['revoked', 'public'] as const);
    const generation = people[student]!.generation;
    const startYear = 1940 + generation * 8 + Math.floor(random() * 8);
    const ongoing = generation >= GENERATIONS.length - 2 && random() < 0.6;
    edges.push({
      id: id(),
      teacher,
      student,
      lineage: people[teacher]!.lineage,
      status,
      visibility,
      primary: primary && (status === 'verified' || status === 'in_arbitration'),
      startYear,
      endYear: ongoing ? null : startYear + 1 + Math.floor(random() * 8),
    });
  };

  for (let generation = 1; generation < GENERATIONS.length; generation += 1) {
    for (const student of byGeneration[generation]!) {
      const teacher = pick(generation - 1, 3);
      people[student]!.lineage = people[teacher]!.lineage;
      addEdge(teacher, student, true);
      const roll = random();
      const extra = EXTRA_TEACHERS.find(([limit]) => roll < limit)![1];
      for (let k = 0; k < extra; k += 1) {
        const from = generation >= 2 && random() < 0.3 ? generation - 2 : generation - 1;
        addEdge(pick(from, 2), student, false);
      }
    }
  }
  return { people, edges };
}

export async function insertBatches<T>(rows: readonly T[], size: number, insert: (batch: readonly T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

/** A person of the last generation with at least three public teachers (both ends public). */
export function deepPerson(graph: ReturnType<typeof generateGraph>): string {
  const { people, edges } = graph;
  const last = GENERATIONS.length - 1;
  const teachers = new Map<number, number>();
  for (const e of edges) {
    const visible = e.visibility === 'public' && (e.status === 'verified' || e.status === 'in_arbitration');
    if (visible && people[e.teacher]!.visibility === 'public' && people[e.student]!.visibility === 'public' && people[e.student]!.generation === last) {
      teachers.set(e.student, (teachers.get(e.student) ?? 0) + 1);
    }
  }
  const found = [...teachers].find(([, count]) => count >= 3);
  if (!found) throw new Error('the generated graph has no person with three public teachers in its last generation');
  return people[found[0]]!.id;
}

export async function loadGraph(url: string, graph: ReturnType<typeof generateGraph>) {
  const { people, edges } = graph;
  await withClient(url, async (client) => {
    await client.query('BEGIN');
    await insertBatches(people, 5_000, (batch) =>
      client.query(
        `INSERT INTO person (id, slug, kind, life_status, stewardship, visibility)
         SELECT id, slug, 'living', 'unknown', 'unclaimed', visibility FROM unnest($1::uuid[], $2::text[], $3::text[]) AS t(id, slug, visibility)`,
        [batch.map((p) => p.id), batch.map((p) => p.slug), batch.map((p) => p.visibility)],
      ),
    );
    await insertBatches(people, 5_000, (batch) =>
      client.query(
        `INSERT INTO person_name (id, person_id, kind, value, script, lang, is_primary)
         SELECT gen_random_uuid(), person_id, 'name', value, 'Latn', 'en', true FROM unnest($1::uuid[], $2::text[]) AS t(person_id, value)`,
        [batch.map((p) => p.id), batch.map((p) => `Perf Person ${p.slug.slice('demo-perf-'.length)}`)],
      ),
    );
    const roots = people.filter((p) => p.generation === 0);
    const lineageIds = roots.map(() => uuidv7());
    await client.query(
      `INSERT INTO lineage (id, slug, name, root_person_id)
       SELECT id, slug, name, root FROM unnest($1::uuid[], $2::text[], $3::text[], $4::uuid[]) AS t(id, slug, name, root)`,
      [lineageIds, roots.map((_, i) => `demo-perf-lineage-${i + 1}`), roots.map((_, i) => `Demo Perf Lineage ${i + 1}`), roots.map((r) => r.id)],
    );
    await insertBatches(edges, 5_000, (batch) =>
      client.query(
        `INSERT INTO teaching_relationship (id, teacher_person_id, student_person_id, lineage_id, status, visibility, is_display_primary, confirmed_at)
         SELECT id, teacher, student, lineage, status, visibility, is_primary, CASE WHEN status IN ('verified', 'in_arbitration', 'revoked') THEN now() END
           FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::boolean[])
             AS t(id, teacher, student, lineage, status, visibility, is_primary)`,
        [
          batch.map((e) => e.id),
          batch.map((e) => people[e.teacher]!.id),
          batch.map((e) => people[e.student]!.id),
          batch.map((e) => lineageIds[e.lineage]!),
          batch.map((e) => e.status),
          batch.map((e) => e.visibility),
          batch.map((e) => e.primary),
        ],
      ),
    );
    await insertBatches(edges, 5_000, (batch) =>
      client.query(
        `INSERT INTO training_period (id, relationship_id, starts_on, ends_on, precision, ongoing)
         SELECT gen_random_uuid(), relationship_id, make_date(start_year, 1, 1),
                CASE WHEN end_year IS NULL THEN NULL ELSE make_date(end_year, 1, 1) END, 'year', end_year IS NULL
           FROM unnest($1::uuid[], $2::int[], $3::int[]) AS t(relationship_id, start_year, end_year)`,
        [batch.map((e) => e.id), batch.map((e) => e.startYear), batch.map((e) => e.endYear)],
      ),
    );
    await client.query('COMMIT');
    await client.query('ANALYZE');
  });
}

/**
 * docs/perf/api.md holds both reports: the query measurements of pnpm perf:queries (M04) and,
 * between these markers, the p95 of the API from pnpm perf:api (M13). Each command rewrites only
 * its own part.
 */
export const API_SECTION_START = '<!-- perf:api: generated by pnpm perf:api (scripts/perf-api.ts) -->';
export const API_SECTION_END = '<!-- /perf:api -->';

/** The perf:api section of `text` (markers included), or null. */
export function apiSection(text: string): string | null {
  const start = text.indexOf(API_SECTION_START);
  const end = text.indexOf(API_SECTION_END);
  return start >= 0 && end > start ? text.slice(start, end + API_SECTION_END.length) : null;
}

/** `text` with its perf:api section replaced by `section` (or `section` appended). */
export function replaceApiSection(text: string, section: string): string {
  const current = apiSection(text);
  if (current) return text.replace(current, () => section);
  return `${text.replace(/\n*$/, '')}\n\n${section}\n`;
}
