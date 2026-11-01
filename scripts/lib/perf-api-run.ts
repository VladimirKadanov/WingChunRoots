// The body of pnpm perf:api (scripts/perf-api.ts, which loads this module after replacing
// next/cache). Fictional data only (D20): the `demo-perf-` graph and `demo-perf-school-` schools.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { closeDb, createRoleDatabase } from '../../src/server/db';
import { repoRoot, withClient } from '../../src/server/db/admin';
import { rolePassword } from '../../src/server/db/env';
import { createTestDatabase } from '../../src/server/db/testing';
import { recomputeLineageMembership } from '../../src/server/jobs/lineage-recompute';
import { handleApiRequest } from '../../src/server/rpc/handler';
import { API_SECTION_END, API_SECTION_START, generateGraph, loadGraph, prng, replaceApiSection } from './perf-graph';

const OUTPUT = 'docs/perf/api.md';
/** The ceiling of plan §4.11 (DEFAULT D24): p95 of the explorer's API under 300 ms. */
export const P95_CEILING_MS = 300;
const APP_URL = 'http://127.0.0.1:3999';
/** Requests per case, after WARMUP unmeasured ones. */
const REQUESTS = 120;
const WARMUP = 10;
const SCHOOLS = 3_000;

interface Case {
  procedure: 'lineage.ego' | 'schools.search';
  input: string;
  /** The request of the i-th call. */
  request: (i: number) => Request;
}

interface Measured {
  case: Case;
  times: number[];
  /** Nodes (ego) or schools (search) of the answers, min–max. */
  sizes: [number, number];
  errors: string[];
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
const ms = (value: number) => `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;

function egoRequest(focusId: string, up: number, down: number, fanoutLimit: number): Request {
  const query = new URLSearchParams({ focusId, up: String(up), down: String(down), fanoutLimit: String(fanoutLimit) });
  return new Request(`${APP_URL}/api/v1/lineage/ego?${query}`, { method: 'GET' });
}

function searchRequest(body: Record<string, unknown>): Request {
  return new Request(`${APP_URL}/api/v1/schools/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function measure(item: Case): Promise<Measured> {
  const times: number[] = [];
  const errors: string[] = [];
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < WARMUP + REQUESTS; i += 1) {
    const started = performance.now();
    const response = await handleApiRequest(item.request(i), 'openapi');
    const text = await response.text();
    const took = performance.now() - started;
    if (!response.ok) {
      errors.push(`HTTP ${response.status}`);
      continue;
    }
    if (i < WARMUP) continue;
    times.push(took);
    const data = JSON.parse(text) as { nodes?: unknown[]; schools?: unknown[] };
    const size = (data.nodes ?? data.schools ?? []).length;
    min = Math.min(min, size);
    max = Math.max(max, size);
  }
  return { case: item, times, sizes: [min === Infinity ? 0 : min, max], errors };
}

/** Fictional schools: a city of the extract, a point within about 15 km of it, a public head instructor of the graph. */
async function loadSchools(url: string, instructors: string[], random: () => number): Promise<{ lat: number; lng: number }[]> {
  return withClient(url, async (client) => {
    const cities = (
      await client.query<{ id: string; lat: number; lng: number }>(
        `SELECT id::text, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng FROM place
          ORDER BY population DESC NULLS LAST, id LIMIT 400`,
      )
    ).rows;
    const slugs: string[] = [];
    const places: string[] = [];
    const privacies: string[] = [];
    const lats: number[] = [];
    const lngs: number[] = [];
    const heads: string[] = [];
    for (let i = 0; i < SCHOOLS; i += 1) {
      const city = cities[Math.floor(random() ** 1.5 * cities.length)]!;
      slugs.push(`demo-perf-school-${String(i).padStart(5, '0')}`);
      places.push(city.id);
      privacies.push(random() < 0.3 ? 'city_only' : 'exact');
      lats.push(city.lat + (random() - 0.5) * 0.25);
      lngs.push(city.lng + (random() - 0.5) * 0.35);
      heads.push(instructors[Math.floor(random() * instructors.length)]!);
    }
    await client.query('BEGIN');
    const inserted = await client.query<{ id: string; slug: string }>(
      `INSERT INTO school (slug, name, place_id, location_privacy, public_point, status)
       SELECT slug, 'Demo Perf Hall ' || substr(slug, 18), place, privacy,
              ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, 'active'
         FROM unnest($1::text[], $2::uuid[], $3::text[], $4::float8[], $5::float8[]) AS t(slug, place, privacy, lat, lng)
       RETURNING id::text, slug`,
      [slugs, places, privacies, lats, lngs],
    );
    const bySlug = new Map(inserted.rows.map((r) => [r.slug, r.id]));
    await client.query(
      `INSERT INTO school_instructor (school_id, person_id, role)
       SELECT school, person, 'head_instructor' FROM unnest($1::uuid[], $2::uuid[]) AS t(school, person)`,
      [slugs.map((s) => bySlug.get(s)!), heads],
    );
    await client.query('COMMIT');
    await client.query('ANALYZE school; ANALYZE school_instructor');
    return cities.map(({ lat, lng }) => ({ lat, lng }));
  });
}

function report(env: { version: string; postgis: string; people: number; edges: number; schools: number; generatedAt: string }, results: Measured[]): string {
  const lines = [
    API_SECTION_START,
    '',
    '## p95 на API (M13)',
    '',
    `Генерирано от \`pnpm perf:api\` (\`scripts/perf-api.ts\`) на ${env.generatedAt}. Не се редактира на ръка. Таванът е p95 < ${P95_CEILING_MS} ms (план §4.11, DEFAULT D24); при по-бавен случай командата завършва с код 1 и таванът не се вдига.`,
    '',
    `- **Сървър:** ${env.version}; PostGIS ${env.postgis}.`,
    `- **Данни:** собствена временна база с демо данните (\`pnpm db:seed\`, включително градовете от извадката на GeoNames), графът на \`pnpm perf:queries\` (${env.people.toLocaleString('en')} измислени личности, ${env.edges.toLocaleString('en')} връзки) и ${env.schools.toLocaleString('en')} измислени школи (\`demo-perf-school-…\`) около 400-те най-големи града, всяка с главен инструктор от графа; \`lineage_membership\` е преизчислена за всяка линия. Базата се изтрива след измерването.`,
    '- **Път:** цялата процедура през HTTP обработчика на `/api/v1` (OpenAPI, както ще я вика мобилното приложение): проверка на входа, услугата с проверките за права, базата през `app_public_ro` с бюджета от 2 s, схемата на изхода и JSON отговорът. Анонимна заявка. Кешът `\'use cache\'` е изключен (заместител на `next/cache`), затова всяка заявка чете базата: това е най-лошият случай на публично четене.',
    `- **Повторения:** ${WARMUP} загряващи и ${REQUESTS} измерени заявки на случай, последователно, от един процес на същата машина.`,
    '',
    '| Процедура | Вход | Размер на отговора | p50 | p95 | макс. | p95 < 300 ms |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of results) {
    const sorted = [...r.times].sort((a, b) => a - b);
    if (sorted.length === 0) {
      lines.push(`| \`${r.case.procedure}\` | ${r.case.input} | — | — | — | — | грешка: ${r.errors[0] ?? 'няма отговор'} |`);
      continue;
    }
    const p95 = percentile(sorted, 95);
    const size = r.sizes[0] === r.sizes[1] ? String(r.sizes[0]) : `${r.sizes[0]}–${r.sizes[1]}`;
    lines.push(
      `| \`${r.case.procedure}\` | ${r.case.input} | ${size} | ${ms(percentile(sorted, 50))} | ${ms(p95)} | ${ms(sorted.at(-1)!)} | ${p95 < P95_CEILING_MS && r.errors.length === 0 ? 'да' : 'НЕ'} |`,
    );
  }
  const worst = results
    .filter((r) => r.times.length > 0)
    .map((r) => ({ r, p95: percentile([...r.times].sort((a, b) => a - b), 95) }))
    .sort((a, b) => b.p95 - a.p95)[0];
  lines.push(
    '',
    worst
      ? `Най-бавният случай е \`${worst.r.case.procedure}\` (${worst.r.case.input}) с p95 ${ms(worst.p95)}.`
      : 'Няма измерен случай.',
    '',
    'Първото измерване в M13 намери бавен план в `schools.search` и `schools.inViewport`: съединението на `school` с изгледа `v_public_school` (`security_barrier`) караше планировчика, който очаква един ред от `ST_DWithin`, да чете целия изглед веднъж за всеки кандидат. При 3,000 школи и 172 в един град това беше p95 680 ms за радиус 50 km, 1,1 s за една заявка и веднъж изтекъл `statement_timeout`. Сега кандидатите идват първо от GiST индекса като масив, а изгледът се чете веднъж по първичния ключ (`radiusQuery` в `src/server/services/schools.ts`); таванът не е променян.',
    '',
    API_SECTION_END,
  );
  return lines.join('\n');
}

export async function main(): Promise<void> {
  const toStdout = process.argv.includes('--stdout');
  // The services read these when a request carries a session; these requests carry none.
  for (const name of ['BETTER_AUTH_SECRET', 'IP_HMAC_KEY', 'MAIL_SEAL_KEY']) process.env[name] ||= `perf-${randomBytes(24).toString('hex')}`;
  process.env.APP_URL = APP_URL;
  console.log('perf:api: creating and seeding a throwaway database');
  const testDb = await createTestDatabase({ seed: true });
  try {
    const graph = generateGraph();
    console.log(`perf:api: loading ${graph.people.length} people and ${graph.edges.length} relationships`);
    await loadGraph(testDb.url, graph);
    const random = prng(20261101);
    const publicPeople = graph.people.filter((p) => p.visibility === 'public');
    // Head instructors from the generations that teach today (4 to 7 of 0 to 8).
    const instructors = publicPeople.filter((p) => p.generation >= 4 && p.generation <= 7).map((p) => p.id);
    console.log(`perf:api: adding ${SCHOOLS} schools`);
    const cities = await loadSchools(testDb.url, instructors, random);
    const lineages = await withClient(testDb.url, async (client) => (await client.query<{ id: string; root: string }>(`SELECT id::text, root_person_id::text AS root FROM lineage WHERE slug LIKE 'demo-perf-%' ORDER BY slug`)).rows);
    console.log(`perf:api: recomputing lineage_membership of ${lineages.length} lineages`);
    const rw = createRoleDatabase('app_rw', testDb.url, rolePassword('app_rw'));
    try {
      for (const l of lineages) await recomputeLineageMembership(rw, l.id);
    } finally {
      await rw.$client.end();
    }
    await withClient(testDb.url, (client) => client.query('ANALYZE'));
    process.env.DATABASE_URL = testDb.url;

    const env = await withClient(testDb.url, async (client) => {
      const one = async (query: string) => (await client.query<Record<string, unknown>>(query)).rows[0]!;
      const anchors = await one(`SELECT
          (SELECT teacher_person_id::text FROM v_public_edge GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1) AS hub,
          (SELECT count(*)::int FROM person) AS people,
          (SELECT count(*)::int FROM teaching_relationship) AS edges,
          (SELECT count(*)::int FROM v_public_school) AS schools,
          version() AS version, postgis_lib_version() AS postgis`);
      return anchors as { hub: string; people: number; edges: number; schools: number; version: string; postgis: string };
    });
    const root = lineages[0]!.root;
    const sample = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
    const focuses = Array.from({ length: WARMUP + REQUESTS }, () => sample(publicPeople).id);
    const centres = Array.from({ length: WARMUP + REQUESTS }, () => sample(cities));
    const roots = Array.from({ length: WARMUP + REQUESTS }, () => sample(lineages).root);
    const cases: Case[] = [
      { procedure: 'lineage.ego', input: 'случайна публична личност; изгледът по подразбиране (up 16, down 2, fanout 50)', request: (i) => egoRequest(focuses[i]!, 16, 2, 50) },
      { procedure: 'lineage.ego', input: 'хъбът с най-много ученици; up 16, down 4, fanout 100 (горните граници)', request: () => egoRequest(env.hub, 16, 4, 100) },
      { procedure: 'lineage.ego', input: 'коренът на линия 1 (най-широкото поддърво); up 16, down 4, fanout 100: таванът от 500 души', request: () => egoRequest(root, 16, 4, 100) },
      { procedure: 'schools.search', input: 'случаен голям град, радиус 50 km', request: (i) => searchRequest({ center: centres[i], radiusKm: 50 }) },
      { procedure: 'schools.search', input: 'случаен голям град, радиус 50 km, филтър по линия (случаен корен)', request: (i) => searchRequest({ center: centres[i], radiusKm: 50, lineageRootId: roots[i] }) },
      { procedure: 'schools.search', input: 'случаен голям град, радиус 500 km (горната граница)', request: (i) => searchRequest({ center: centres[i], radiusKm: 500 }) },
      { procedure: 'schools.search', input: 'без център: всички школи на линия 1 (списъкът без карта)', request: () => searchRequest({ lineageRootId: root }) },
    ];
    const results: Measured[] = [];
    for (const item of cases) {
      console.log(`perf:api: ${item.procedure} (${item.input})`);
      const measured = await measure(item);
      const sorted = [...measured.times].sort((a, b) => a - b);
      if (sorted.length) console.log(`perf:api:   p50 ${ms(percentile(sorted, 50))}, p95 ${ms(percentile(sorted, 95))}, max ${ms(sorted.at(-1)!)}${measured.errors.length ? `, ${measured.errors.length} errors (${measured.errors[0]})` : ''}`);
      results.push(measured);
    }
    const text = report({ ...env, generatedAt: new Date().toISOString().slice(0, 10) }, results);
    if (toStdout) {
      console.log(text);
    } else {
      const file = path.join(repoRoot(), OUTPUT);
      writeFileSync(file, replaceApiSection(existsSync(file) ? readFileSync(file, 'utf8') : '', text));
      console.log(`perf:api: wrote ${OUTPUT}`);
    }
    const over = results.filter((r) => r.errors.length > 0 || r.times.length === 0 || percentile([...r.times].sort((a, b) => a - b), 95) >= P95_CEILING_MS);
    for (const r of over) console.error(`perf:api: FAIL ${r.case.procedure} (${r.case.input}): p95 not under ${P95_CEILING_MS} ms or errors`);
    if (over.length > 0) process.exitCode = 1;
    else console.log(`perf:api: every p95 is under ${P95_CEILING_MS} ms`);
  } finally {
    await closeDb();
    // --keep leaves the database for a closer look (EXPLAIN); its name is printed, never its URL.
    if (process.argv.includes('--keep')) console.log(`perf:api: kept the database ${testDb.name}`);
    else await testDb.drop();
  }
}
