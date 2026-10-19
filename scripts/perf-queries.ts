// pnpm perf:queries (milestone M04, In scope 7; plan §6.3): the lineage queries on a generated
// graph of about 100,000 teaching relationships, on whatever PostgreSQL this machine has (16 in a
// cloud session, 18 locally and in CI). It creates its own throwaway database on the
// TEST_DATABASE_URL server (src/server/db/testing.ts), fills it with a deterministic fictional
// graph (`demo-perf-` slugs, uuid keys from the app's UUIDv7), runs lineage.ego, ancestors,
// subtree and paths, people.get and people.students exactly as the service does (app_public_ro, the public views, a read-only
// transaction with statement_timeout 2s), times each a few times, takes EXPLAIN (ANALYZE,
// BUFFERS) of every statement, writes docs/perf/api.md and drops the database.
//
//   pnpm perf:queries            # writes docs/perf/api.md
//   pnpm perf:queries --stdout   # prints the report instead

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { createRoleDatabase, type Database } from '../src/server/db';
import { repoRoot, withClient } from '../src/server/db/admin';
import { rolePassword } from '../src/server/db/env';
import { uuidv7 } from '../src/server/db/ids';
import { createTestDatabase } from '../src/server/db/testing';
import {
  ancestorsGraph,
  DESCENDANTS_CAP,
  egoGraph,
  type Executor,
  lineageRefs,
  NO_EXTRAS,
  NODE_CAP,
  pathsGraph,
  personCounts,
  publicProfileRow,
  readTransaction,
  studentPage,
  STUDENTS_PAGE_SIZE,
  subtreeGraph,
} from '../src/server/services/lineage-graph';

const OUTPUT = 'docs/perf/api.md';
const RUNS = 7;
/** People per generation: 9 generations, about 55,000 people. */
const GENERATIONS = [5, 25, 100, 400, 1_500, 4_500, 10_000, 16_000, 22_500];
/** Extra teachers per student beyond the first: 0, 1, 2 or 3, about 0.8 on average. */
const EXTRA_TEACHERS = [
  [0.45, 0],
  [0.8, 1],
  [0.93, 2],
  [1, 3],
] as const;

/** A small deterministic PRNG (mulberry32), so every run measures the same graph. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PerfPerson {
  id: string;
  slug: string;
  generation: number;
  lineage: number;
  visibility: 'public' | 'involved_only';
}
interface PerfEdge {
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
function generateGraph() {
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

async function insertBatches<T>(rows: readonly T[], size: number, insert: (batch: readonly T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

/** A person of the last generation with at least three public teachers (both ends public). */
function deepPerson(graph: ReturnType<typeof generateGraph>): string {
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

async function loadGraph(url: string, graph: ReturnType<typeof generateGraph>) {
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

// --- Measuring --------------------------------------------------------------------------------

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Loops'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
}
interface Explained {
  Plan: PlanNode;
  'Planning Time': number;
  'Execution Time': number;
}
interface Statement {
  label: string;
  ms: number;
  rows: number;
  plan?: Explained;
  error?: string;
}

const dialect = new PgDialect();

/** The first words of a statement, for the report: its first CTE or its first clause. */
function labelOf(query: SQL): string {
  const text = dialect
    .sqlToQuery(query)
    .sql.replace(/\s+/g, ' ')
    .trim()
    // The viewer's own edges (empty here) come first in every lineage query.
    .replace(/extra AS \( SELECT x\.id, .*? FROM jsonb_to_recordset\(\$\d+::jsonb\) AS x\([^)]*\) \),? ?/, '');
  const cte = /^WITH (?:RECURSIVE )?([a-z_]+)\(/i.exec(text);
  if (cte) return `WITH ${cte[1]} …`;
  return `${text.replace(/^WITH (?:RECURSIVE )?/, '').slice(0, 48)}…`;
}

/** An Executor that times every statement and, when asked, explains it in the same snapshot. */
class Recorder implements Executor {
  readonly statements: Statement[] = [];
  constructor(
    private readonly inner: Executor,
    private readonly explain: boolean,
  ) {}

  async execute(query: SQL) {
    const started = performance.now();
    const result = await this.inner.execute(query);
    const statement: Statement = { label: labelOf(query), ms: performance.now() - started, rows: result.rows.length };
    if (this.explain) {
      try {
        const plan = await this.inner.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
        statement.plan = (plan.rows[0]!['QUERY PLAN'] as Explained[])[0];
      } catch (error) {
        statement.error = error instanceof Error ? error.message : String(error);
      }
    }
    this.statements.push(statement);
    return result;
  }
}

interface Case {
  procedure: string;
  input: string;
  run: (ex: Executor) => Promise<{ nodes: number; edges: number; truncated?: boolean }>;
}

interface Measured {
  case: Case;
  nodes: number;
  edges: number;
  truncated: boolean;
  times: number[];
  statements: Statement[];
  error?: string;
}

async function measure(db: Database, item: Case): Promise<Measured> {
  const times: number[] = [];
  let shape = { nodes: 0, edges: 0, truncated: false };
  try {
    for (let i = 0; i <= RUNS; i += 1) {
      const started = performance.now();
      const result = await readTransaction(db, (tx) => item.run(tx));
      // The first run warms the caches and is not counted.
      if (i > 0) times.push(performance.now() - started);
      shape = { nodes: result.nodes, edges: result.edges, truncated: result.truncated ?? false };
    }
    const recorder = await readTransaction(db, async (tx) => {
      const r = new Recorder(tx, true);
      await item.run(r);
      return r;
    });
    return { case: item, ...shape, times, statements: recorder.statements };
  } catch (error) {
    return { case: item, ...shape, times, statements: [], error: error instanceof Error ? error.message : String(error) };
  }
}

// --- The report (Bulgarian, like the rest of docs/) -------------------------------------------

const ms = (value: number) => `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? Number.NaN : sorted[Math.floor(sorted.length / 2)]!;
};

/** Scans of a plan as "Index Only Scan teaching_relationship_teacher_cover_idx ×12". */
function scansOf(plan: PlanNode): { text: string; seqScans: string[] } {
  const counts = new Map<string, number>();
  const seqScans: string[] = [];
  const walk = (node: PlanNode) => {
    if (/Scan$/.test(node['Node Type']) && (node['Relation Name'] || node['Index Name'])) {
      const what = node['Index Name'] ?? node['Relation Name']!;
      const key = `${node['Node Type']} ${what}`;
      counts.set(key, (counts.get(key) ?? 0) + (node['Actual Loops'] ?? 1));
      if (node['Node Type'] === 'Seq Scan' && node['Relation Name']) seqScans.push(node['Relation Name']);
    }
    node.Plans?.forEach(walk);
  };
  walk(plan);
  const text = [...counts].map(([key, loops]) => `${key} ×${loops}`).join('; ');
  return { text: text || '—', seqScans };
}

const LARGE_TABLES = new Set(['person', 'person_name', 'teaching_relationship', 'training_period']);
/** A statement with a full scan of a large table that takes longer than this needs an index. */
const SEQ_SCAN_BUDGET_MS = 50;

interface Counts {
  people: number;
  publicPeople: number;
  lineages: number;
  edges: number;
  publicEdges: number;
}

function report(env: { version: string; postgis: string; counts: Counts; generatedAt: string }, results: Measured[]): string {
  const lines: string[] = [];
  /** Full scans of the large tables: the table and how long the statement around it took. */
  const seqOnLarge: { table: string; ms: number }[] = [];
  lines.push(
    '# Заявки за родословието: измерване (M04)',
    '',
    `Генерирано от \`pnpm perf:queries\` (\`scripts/perf-queries.ts\`) на ${env.generatedAt}. Не се редактира на ръка: при промяна на заявките, изгледите или индексите командата се пуска отново и резултатът се записва (план §6.3).`,
    '',
    '## Среда',
    '',
    `- **Сървър:** ${env.version}`,
    `- **PostGIS:** ${env.postgis}`,
    `- **Данни:** собствена временна база, изтрита след измерването. ${env.counts.people.toLocaleString('en')} измислени личности (\`demo-perf-…\`, ${env.counts.publicPeople.toLocaleString('en')} публични) в ${GENERATIONS.length} поколения и ${env.counts.lineages} линии; ${env.counts.edges.toLocaleString('en')} връзки учител–ученик (${env.counts.publicEdges.toLocaleString('en')} видими през \`v_public_edge\`), всяка с един период на обучение. Ключовете са \`uuid\` (UUIDv7 от приложението).`,
    '- **Достъп:** като в услугата: ролята `app_public_ro`, изгледите `v_public_person` и `v_public_edge`, транзакция `READ ONLY`, `REPEATABLE READ`, първа заявка `SET LOCAL statement_timeout = \'2s\'`; същите функции от `src/server/services/lineage-graph.ts`.',
    `- **Повторения:** една загряваща и ${RUNS} измерени заявки за всеки случай (времето е цялата транзакция, видяно от Node). Плановете са от \`EXPLAIN (ANALYZE, BUFFERS)\` в отделна транзакция след тях, затова буферите са главно попадения в кеша.`,
    '',
    '## Резултати',
    '',
    `При \`people.get\` „Възли“ е 1 (профилът), „Ребра“ е учители + ученици, а „Таван“ е таванът на броя на потомците (${DESCENDANTS_CAP.toLocaleString('en')}). При \`people.students\` „Възли“ са учениците на страницата, а „Ребра“ са всички публични ученици на учителя.`,
    '',
    `| Процедура | Вход | Възли | Ребра | Таван (${NODE_CAP}) | мин. | медиана | макс. |`,
    '|---|---|---|---|---|---|---|---|',
  );
  for (const r of results) {
    if (r.error) {
      lines.push(`| \`${r.case.procedure}\` | ${r.case.input} | — | — | — | грешка: ${r.error.replace(/\|/g, '\\|')} | | |`);
      continue;
    }
    lines.push(
      `| \`${r.case.procedure}\` | ${r.case.input} | ${r.nodes} | ${r.edges} | ${r.truncated ? 'достигнат' : 'не'} | ${ms(Math.min(...r.times))} | ${ms(median(r.times))} | ${ms(Math.max(...r.times))} |`,
    );
  }
  lines.push('', '## Планове', '');
  for (const r of results) {
    lines.push(`### \`${r.case.procedure}\` — ${r.case.input}`, '');
    if (r.statements.length === 0) {
      lines.push(`Няма план: ${r.error ?? 'неизвестна грешка'}.`, '');
      continue;
    }
    lines.push('| # | Заявка | Редове | Изпълнение | Планиране | Буфери (hit / read) | Сканирания (×повторения) |', '|---|---|---|---|---|---|---|');
    r.statements.forEach((s, i) => {
      if (!s.plan) {
        lines.push(`| ${i + 1} | \`${s.label}\` | ${s.rows} | ${ms(s.ms)} | — | — | EXPLAIN: ${s.error ?? '—'} |`);
        return;
      }
      const scans = scansOf(s.plan.Plan);
      for (const table of scans.seqScans) if (LARGE_TABLES.has(table)) seqOnLarge.push({ table, ms: s.plan['Execution Time'] });
      lines.push(
        `| ${i + 1} | \`${s.label}\` | ${s.rows} | ${ms(s.plan['Execution Time'])} | ${ms(s.plan['Planning Time'])} | ${s.plan.Plan['Shared Hit Blocks'] ?? 0} / ${s.plan.Plan['Shared Read Blocks'] ?? 0} | ${scans.text} |`,
      );
    });
    lines.push('');
  }
  const slowest = Math.max(...results.flatMap((r) => r.times));
  const failed = results.filter((r) => r.error);
  lines.push(
    '## Изводи',
    '',
    failed.length === 0
      ? `- Всички ${results.length} случая завършват под тавана от 2 s на \`statement_timeout\`; най-бавната измерена транзакция е ${ms(slowest)}.`
      : `- ${failed.length} случая не завършиха: ${failed.map((r) => `\`${r.case.procedure}\` (${r.case.input})`).join(', ')}.`,
    seqOnLarge.length === 0
      ? '- Никой план не чете последователно големите таблици (`person`, `person_name`, `teaching_relationship`, `training_period`): обхождането върви по индексите `teaching_relationship_teacher_cover_idx` и `teaching_relationship_student_cover_idx` и по първичните ключове. Не е нужна нова миграция с индекси.'
      : `- Последователно четене на големи таблици: ${[...new Set(seqOnLarge.map((x) => x.table))].map((t) => `\`${t}\``).join(', ')}, в заявки от най-много ${ms(Math.max(...seqOnLarge.map((x) => x.ms)))}. ${
          Math.max(...seqOnLarge.map((x) => x.ms)) < SEQ_SCAN_BUDGET_MS
            ? `Това са хеш съединения, които планировчикът избира за няколкостотин реда наведнъж, и \`LIMIT 1\` при линиите; всяка такава заявка е под ${SEQ_SCAN_BUDGET_MS} ms, затова не е нужна нова миграция с индекси. При десеткратно по-голяма база измерването се повтаря.`
            : `Поне една такава заявка е над ${SEQ_SCAN_BUDGET_MS} ms: виж плановете по-горе и добави индекс с нова миграция.`
        }`,
    '- Целта на план §4.11 (p95 < 300 ms за API на изследователя) се проверява с `pnpm perf:api` в M13 през HTTP; тук се мерят само заявките към базата.',
    '',
  );
  return lines.join('\n');
}

async function main() {
  const toStdout = process.argv.includes('--stdout');
  console.log('perf:queries: generating the graph');
  const graph = generateGraph();
  const testDb = await createTestDatabase();
  let db: Database | undefined;
  try {
    console.log(`perf:queries: loading ${graph.people.length} people and ${graph.edges.length} relationships into a throwaway database`);
    await loadGraph(testDb.url, graph);
    db = createRoleDatabase('app_public_ro', testDb.url, rolePassword('app_public_ro'));

    const env = await withClient(testDb.url, async (client) => {
      const one = async (query: string) => (await client.query<Record<string, unknown>>(query)).rows[0]!;
      const version = String((await one('SELECT version() AS v')).v);
      const postgis = String((await one('SELECT postgis_lib_version() AS v')).v);
      const counts = await one(`SELECT
          (SELECT count(*)::int FROM person) AS people,
          (SELECT count(*)::int FROM v_public_person) AS "publicPeople",
          (SELECT count(*)::int FROM lineage) AS lineages,
          (SELECT count(*)::int FROM teaching_relationship) AS edges,
          (SELECT count(*)::int FROM v_public_edge) AS "publicEdges"`);
      const anchors = await one(`SELECT
          (SELECT teacher_person_id::text FROM v_public_edge GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1) AS hub,
          (SELECT root_person_id::text FROM lineage ORDER BY slug LIMIT 1) AS root`);
      return { version, postgis, counts: counts as unknown as Counts, anchors: anchors as Record<string, string> };
    });
    const { hub, root } = env.anchors;
    const leaf = deepPerson(graph);
    const hubStudents = await withClient(testDb.url, async (client) =>
      Number(
        (await client.query<{ n: number }>('SELECT count(DISTINCT student_person_id)::int AS n FROM v_public_edge WHERE teacher_person_id = $1', [hub]))
          .rows[0]!.n,
      ),
    );
    const lastPage = Math.max(1, Math.ceil(hubStudents / STUDENTS_PAGE_SIZE));
    // people.get as cachedProfile reads it (src/server/services/lineage-public.ts).
    const profile = async (ex: Executor, personId: string) => {
      const row = await publicProfileRow(ex, personId);
      const counts = await personCounts(ex, personId);
      await lineageRefs(ex, counts.lineageIds);
      return { nodes: row ? 1 : 0, edges: counts.teachers + counts.students, truncated: counts.descendantsCapped };
    };
    const students = async (ex: Executor, options: Parameters<typeof studentPage>[2]) => {
      const page = await studentPage(ex, hub!, options, NO_EXTRAS);
      return { nodes: page.active.length + page.historical.length, edges: page.activeTotal + page.historicalTotal };
    };
    const shape = (g: { nodes: unknown[]; edges: unknown[]; truncated?: boolean }) => ({ nodes: g.nodes.length, edges: g.edges.length, truncated: g.truncated });
    const cases: Case[] = [
      { procedure: 'lineage.ego', input: 'хъбът с най-много ученици; up 16, down 2, fanout 50', run: async (ex) => shape(await egoGraph(ex, { focusId: hub!, up: 16, down: 2, fanoutLimit: 50 }, NO_EXTRAS)) },
      { procedure: 'lineage.ego', input: 'хъбът; up 16, down 4, fanout 100 (горните граници)', run: async (ex) => shape(await egoGraph(ex, { focusId: hub!, up: 16, down: 4, fanoutLimit: 100 }, NO_EXTRAS)) },
      { procedure: 'lineage.ego', input: 'коренът на линия 1 (най-широкото поддърво); up 16, down 4, fanout 100', run: async (ex) => shape(await egoGraph(ex, { focusId: root!, up: 16, down: 4, fanoutLimit: 100 }, NO_EXTRAS)) },
      { procedure: 'lineage.ego', input: 'личност от последното поколение с 3+ учители; up 16, down 2, fanout 50', run: async (ex) => shape(await egoGraph(ex, { focusId: leaf, up: 16, down: 2, fanoutLimit: 50 }, NO_EXTRAS)) },
      { procedure: 'lineage.ancestors', input: 'същата личност (всички предци)', run: async (ex) => shape(await ancestorsGraph(ex, leaf, NO_EXTRAS)) },
      { procedure: 'lineage.subtree', input: 'коренът на линия 1; depth 3', run: async (ex) => shape(await subtreeGraph(ex, { rootId: root!, lineageId: null, depth: 3 }, NO_EXTRAS)) },
      { procedure: 'lineage.subtree', input: 'коренът на линия 1; depth 6 (горната граница)', run: async (ex) => shape(await subtreeGraph(ex, { rootId: root!, lineageId: null, depth: 6 }, NO_EXTRAS)) },
      { procedure: 'lineage.paths', input: 'личността от последното поколение; limit 50', run: async (ex) => shape(await pathsGraph(ex, { focusId: leaf, limit: 50 }, NO_EXTRAS)) },
      { procedure: 'people.get', input: 'коренът на линия 1 (броят на потомците до тавана)', run: (ex) => profile(ex, root!) },
      { procedure: 'people.get', input: 'хъбът', run: (ex) => profile(ex, hub!) },
      { procedure: 'people.students', input: `хъбът (${hubStudents} ученици); страница 1 по име`, run: (ex) => students(ex, { page: 1, pageSize: STUDENTS_PAGE_SIZE, order: 'name' }) },
      { procedure: 'people.students', input: `хъбът; последната страница (${lastPage}) по име`, run: (ex) => students(ex, { page: lastPage, pageSize: STUDENTS_PAGE_SIZE, order: 'name' }) },
      { procedure: 'people.students', input: 'хъбът; 12 по старшинство (профилът)', run: (ex) => students(ex, { page: 1, pageSize: 12, order: 'seniority' }) },
    ];
    const results: Measured[] = [];
    for (const item of cases) {
      console.log(`perf:queries: ${item.procedure} (${item.input})`);
      results.push(await measure(db, item));
    }
    const text = report({ ...env, generatedAt: new Date().toISOString().slice(0, 10) }, results);
    if (toStdout) {
      console.log(text);
    } else {
      writeFileSync(path.join(repoRoot(), OUTPUT), text);
      console.log(`perf:queries: wrote ${OUTPUT}`);
    }
  } finally {
    await db?.$client.end();
    await testDb.drop();
  }
}

main().catch((error: unknown) => {
  console.error(`perf:queries: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
