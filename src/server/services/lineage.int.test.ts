// The lineage API (milestone M04, Done when 3): ego, ancestors, subtree and paths against the
// seeded demo fixture (src/fixtures), privacy for anonymous and involved viewers (DEFAULT D03),
// the statement timeout, the caps, the cache tags, and the same answer over /api/v1 and /api/rpc.
// Runs against a throwaway database, seeded with the demo data.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inspect } from 'node:util';

import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, signIn, TEST_APP_URL, TEST_PASSWORD } from '../auth/test-support';
import type { Principal } from '../auth/principal';
import { closeDb, createRoleDatabase, getDb } from '../db';
import { rolePassword } from '../db/env';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import type { LineageGraphDto } from '../dto/public';
import { stopProducer } from '../jobs/boss';
import { handleApiRequest } from '../rpc/handler';
import { OPENAPI_FILE, openApiJson } from '../rpc/openapi';
import { lineageAncestors, lineageEgo, lineagePaths, lineageSubtree, personProfile, personStudents } from './lineage';
import { LineageReadError, readDeadline, readTransaction } from './lineage-graph';
import { cachedEgo, cachedProfile, cachedSubtree } from './lineage-public';

// 'use cache' is a plain string outside Next.js; cacheTag records what the entry would carry.
const cache = vi.hoisted(() => ({ tags: [] as string[] }));
vi.mock('next/cache', () => ({
  cacheTag: (...tags: string[]) => {
    cache.tags.push(...tags);
  },
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
const ids: Record<string, string> = {};
let pendingUserId: string;
let hubUserId: string;

const SLUGS = [
  'demo-shared-ancestor',
  'demo-root-a',
  'demo-root-b',
  'demo-hub-a',
  'demo-a-001',
  'demo-a-002',
  'demo-b-001',
  'demo-two-lineages',
  'demo-converging',
  'demo-pending',
  'demo-claim-only-teacher',
  'demo-under-review',
  'demo-arbitration',
  'demo-cjk-name',
];

beforeAll(async () => {
  setTestAuthEnv();
  // The demo accounts get this throwaway password, so the bearer test can sign one in.
  process.env.E2E_PASSWORD = TEST_PASSWORD;
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
  const rows = await getDb().execute<{ slug: string; id: string; claimed_by_user_id: string | null }>(
    sql`SELECT slug, id::text AS id, claimed_by_user_id::text AS claimed_by_user_id FROM person WHERE slug = ANY(${`{${SLUGS.join(',')}}`}::text[])`,
  );
  for (const r of rows.rows) ids[r.slug] = r.id;
  expect(Object.keys(ids).sort()).toEqual([...SLUGS].sort());
  pendingUserId = rows.rows.find((r) => r.slug === 'demo-pending')!.claimed_by_user_id!;
  hubUserId = rows.rows.find((r) => r.slug === 'demo-hub-a')!.claimed_by_user_id!;
});

afterAll(async () => {
  await stopProducer();
  await closeDb();
  await testDb?.drop();
  delete process.env.E2E_PASSWORD;
});

beforeEach(() => {
  cache.tags.length = 0;
});

function principalOf(userId: string): Principal {
  return {
    user: { id: userId, email: 'demo@example.test', emailVerified: true, role: 'user', twoFactorEnabled: false },
    session: { id: 'test-session', expiresAt: new Date(Date.now() + 3_600_000), twoFactorVerifiedAt: null },
    via: 'bearer',
  };
}

const nodeIds = (g: { nodes: { id: string }[] }) => new Set(g.nodes.map((n) => n.id));
const studentsOf = (slug: string, options: Partial<{ page: number; pageSize: number; order: 'name' | 'seniority' }> = {}) => ({
  slug,
  page: 1,
  pageSize: 50,
  order: 'name' as const,
  ...options,
});
const slugsOf = (g: { nodes: { slug: string }[] }) => g.nodes.map((n) => n.slug).sort();
const edgeBetween = (g: LineageGraphDto, teacher: string, student: string) =>
  g.edges.find((e) => e.teacherId === ids[teacher] && e.studentId === ids[student]);

/** Descendants of `rootId` to `depth` generations (with the root), by an independent recursive query. */
async function descendantsOf(rootId: string, depth: number, lineageId: string | null): Promise<Set<string>> {
  const r = await getDb().execute<{ id: string }>(sql`
    WITH RECURSIVE d(id, depth) AS (
      SELECT ${rootId}::uuid, 0
      UNION
      SELECT pe.student_person_id, d.depth + 1 FROM d JOIN v_public_edge pe ON pe.teacher_person_id = d.id
       WHERE d.depth < ${depth}::int AND (${lineageId}::uuid IS NULL OR pe.lineage_id = ${lineageId}::uuid)
    )
    SELECT DISTINCT id::text AS id FROM d`);
  return new Set(r.rows.map((x) => x.id));
}

async function ancestorsOf(personId: string): Promise<Set<string>> {
  const r = await getDb().execute<{ id: string }>(sql`
    WITH RECURSIVE u(id) AS (
      SELECT ${personId}::uuid
      UNION
      SELECT pe.teacher_person_id FROM u JOIN v_public_edge pe ON pe.student_person_id = u.id
    )
    SELECT id::text AS id FROM u`);
  return new Set(r.rows.map((x) => x.id));
}

/** For every node: the students shown plus those counted in hiddenCounts are its childCount. */
function expectCountsAddUp(g: LineageGraphDto) {
  const shown = new Map<string, Set<string>>();
  for (const e of g.edges) if (e.visibility === 'public') shown.set(e.teacherId, (shown.get(e.teacherId) ?? new Set()).add(e.studentId));
  for (const n of g.nodes) {
    const hidden = g.hiddenCounts[n.id]?.students ?? 0;
    expect((shown.get(n.id)?.size ?? 0) + hidden, n.slug).toBe(n.childCount);
    expect(n.hasMoreChildren, n.slug).toBe(hidden > 0);
  }
}

async function api(kind: 'openapi' | 'rpc', path: string, query: Record<string, unknown>, token?: string) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  let request: Request;
  if (kind === 'openapi') {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    request = new Request(`${TEST_APP_URL}/api/v1${path}?${qs}`, { method: 'GET', headers });
  } else {
    headers.set('content-type', 'application/json');
    request = new Request(`${TEST_APP_URL}/api/rpc${path}`, { method: 'POST', headers, body: JSON.stringify({ json: query }) });
  }
  const response = await handleApiRequest(request, kind);
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: kind === 'rpc' ? (body.json as Record<string, unknown>) : body };
}

describe('the four graph procedures on the anchor records', () => {
  it('ego of demo-two-lineages: one teacher in each lineage, primary and cross-lineage, both verified', async () => {
    const g = await lineageEgo(null, { focusId: ids['demo-two-lineages']!, up: 1, down: 0, fanoutLimit: 50 });
    expect(slugsOf(g)).toEqual(['demo-a-001', 'demo-b-001', 'demo-two-lineages']);
    const a = edgeBetween(g, 'demo-a-001', 'demo-two-lineages')!;
    const b = edgeBetween(g, 'demo-b-001', 'demo-two-lineages')!;
    expect([a.kind, b.kind]).toEqual(['primary', 'crossLineage']);
    expect([a.status, b.status]).toEqual(['verified', 'verified']);
    expect(a.lineageId).not.toBe(b.lineageId);
    expect(g.lineages.map((l) => l.slug)).toEqual(['demo-lineage-a', 'demo-lineage-b']);
    // The teachers' own teachers exist but are outside this view.
    expect(g.hiddenCounts[ids['demo-a-001']!]!.teachers).toBe(1);
    expect(g.focusId).toBe(ids['demo-two-lineages']);
    expect(g.dataVersion).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ego with the defaults walks every generation up and two down', async () => {
    const g = await lineageEgo(null, { focusId: ids['demo-root-a']!, up: 16, down: 2, fanoutLimit: 100 });
    // Every ancestor, and every descendant to two generations (no one has more than 100 students
    // here except demo-hub-a, whose first 100 by name are the ones shown).
    const ancestors = await ancestorsOf(ids['demo-root-a']!);
    const students = await getDb().execute<{ id: string }>(sql`
      SELECT pe.student_person_id::text AS id FROM v_public_edge pe WHERE pe.teacher_person_id = ${ids['demo-root-a']}::uuid`);
    expect(students.rows.length).toBeLessThanOrEqual(100);
    const expected = new Set([...ancestors, ...students.rows.map((r) => r.id)]);
    for (const child of students.rows) {
      const grandchildren = await getDb().execute<{ id: string }>(sql`
        SELECT x.id::text AS id FROM (
          SELECT DISTINCT pe.student_person_id AS id, vp.display_name
            FROM v_public_edge pe JOIN v_public_person vp ON vp.id = pe.student_person_id
           WHERE pe.teacher_person_id = ${child.id}::uuid) x
         ORDER BY x.display_name COLLATE "und-x-icu", x.id LIMIT 100`);
      for (const r of grandchildren.rows) expected.add(r.id);
    }
    expect(expected.size).toBeLessThan(500);
    expect(nodeIds(g)).toEqual(expected);
    const n = nodeIds(g);
    for (const slug of ['demo-shared-ancestor', 'demo-hub-a', 'demo-a-001', 'demo-converging', 'demo-two-lineages']) expect(n.has(ids[slug]!)).toBe(true);
    expect(g.nodes[0]!.id).toBe(ids['demo-root-a']);
  });

  it('ancestors of demo-converging: both teachers, their teacher and the shared ancestor, each once', async () => {
    const g = await lineageAncestors(null, { focusId: ids['demo-converging']! });
    expect(slugsOf(g)).toEqual(['demo-a-002', 'demo-converging', 'demo-hub-a', 'demo-root-a', 'demo-shared-ancestor']);
    expect(edgeBetween(g, 'demo-hub-a', 'demo-converging')!.kind).toBe('primary');
    expect(edgeBetween(g, 'demo-a-002', 'demo-converging')!.kind).toBe('converging');
    expect(g.edges).toHaveLength(5);
  });

  it('subtree of demo-root-a to depth 2, and only along one lineage', async () => {
    const g = await lineageSubtree(null, { rootId: ids['demo-root-a']!, depth: 2 });
    // Exactly the descendants an independent recursive query finds (under the cap here).
    const expected = await descendantsOf(ids['demo-root-a']!, 2, null);
    expect(expected.size).toBeLessThan(500);
    expect(nodeIds(g)).toEqual(expected);
    expect(g.truncated).toBe(false);
    const n = nodeIds(g);
    for (const slug of ['demo-hub-a', 'demo-a-001', 'demo-a-002', 'demo-converging', 'demo-two-lineages']) expect(n.has(ids[slug]!)).toBe(true);
    expect(n.has(ids['demo-shared-ancestor']!)).toBe(false);
    // demo-converging has two teachers in this subtree: both edges are there.
    expect(edgeBetween(g, 'demo-hub-a', 'demo-converging')).toBeDefined();
    expect(edgeBetween(g, 'demo-a-002', 'demo-converging')).toBeDefined();

    const lineageB = g.lineages.find((l) => l.slug === 'demo-lineage-b')!.id;
    const b = await lineageSubtree(null, { rootId: ids['demo-shared-ancestor']!, depth: 2, lineageId: lineageB });
    expect(nodeIds(b)).toEqual(await descendantsOf(ids['demo-shared-ancestor']!, 2, lineageB));
    expect(nodeIds(b).has(ids['demo-root-b']!)).toBe(true);
    expect(nodeIds(b).has(ids['demo-root-a']!)).toBe(false);
    expect(new Set(b.edges.map((e) => e.lineageId)).size).toBe(1);
  });

  it('paths of demo-converging and demo-two-lineages: every route to the shared ancestor, the display-primary route first', async () => {
    const c = await lineagePaths(null, { focusId: ids['demo-converging']!, limit: 50 });
    expect(c.totalPaths).toBe(2);
    expect(c.totalPathsCapped).toBe(false);
    const names = (p: { personIds: string[] }) => p.personIds.map((id) => c.nodes.find((n) => n.id === id)!.slug);
    expect(names(c.paths[0]!)).toEqual(['demo-shared-ancestor', 'demo-root-a', 'demo-hub-a', 'demo-converging']);
    expect(names(c.paths[1]!)).toEqual(['demo-shared-ancestor', 'demo-root-a', 'demo-a-002', 'demo-converging']);
    for (const p of c.paths) expect(p.edgeIds).toHaveLength(p.personIds.length - 1);

    const t = await lineagePaths(null, { focusId: ids['demo-two-lineages']!, limit: 1 });
    expect(t.totalPaths).toBe(2);
    expect(t.paths).toHaveLength(1);
    expect(t.paths[0]!.personIds.map((id) => t.nodes.find((n) => n.id === id)!.slug)).toEqual([
      'demo-shared-ancestor',
      'demo-root-a',
      'demo-a-001',
      'demo-two-lineages',
    ]);
  });

  it('a person without recorded teachers has no routes', async () => {
    const p = await lineagePaths(null, { focusId: ids['demo-shared-ancestor']!, limit: 50 });
    expect(p.paths).toEqual([]);
    expect(p.totalPaths).toBe(0);
  });
});

describe('caps', () => {
  it('the fan-out limit caps the students of demo-hub-a and hiddenCounts reports the rest', async () => {
    const all = await getDb().execute<{ n: number }>(
      sql`SELECT count(DISTINCT student_person_id)::int AS n FROM v_public_edge WHERE teacher_person_id = ${ids['demo-hub-a']}::uuid`,
    );
    const total = all.rows[0]!.n;
    expect(total).toBeGreaterThan(100);
    const g = await lineageEgo(null, { focusId: ids['demo-hub-a']!, up: 0, down: 1, fanoutLimit: 10 });
    const students = g.edges.filter((e) => e.teacherId === ids['demo-hub-a']);
    expect(students).toHaveLength(10);
    expect(g.nodes).toHaveLength(11);
    const hub = g.nodes.find((n) => n.id === ids['demo-hub-a'])!;
    expect(hub.childCount).toBe(total);
    expect(hub.hasMoreChildren).toBe(true);
    expect(g.hiddenCounts[ids['demo-hub-a']!]).toEqual({ teachers: 1, students: total - 10 });
  });

  it('no answer has more than about 500 people: the subtree is cut at exactly 500, the rest counted', async () => {
    const all = await descendantsOf(ids['demo-shared-ancestor']!, 6, null);
    expect(all.size).toBeGreaterThan(500);
    const g = await lineageSubtree(null, { rootId: ids['demo-shared-ancestor']!, depth: 6 });
    expect(g.truncated).toBe(true);
    expect(g.nodes).toHaveLength(500);
    for (const id of nodeIds(g)) expect(all.has(id)).toBe(true);
    expectCountsAddUp(g);
    const e = await lineageEgo(null, { focusId: ids['demo-shared-ancestor']!, up: 16, down: 4, fanoutLimit: 100 });
    expect(e.nodes.length).toBeLessThanOrEqual(500);
    expect(e.truncated).toBe(e.nodes.length === 500);
    expectCountsAddUp(e);
  });

  it('every number is bounded: out-of-range input is a 400 with the field named', async () => {
    const focusId = ids['demo-hub-a']!;
    for (const [query, field] of [
      [{ focusId, up: 17 }, 'up'],
      [{ focusId, down: 5 }, 'down'],
      [{ focusId, fanoutLimit: 0 }, 'fanoutLimit'],
      [{ focusId, fanoutLimit: 101 }, 'fanoutLimit'],
      [{ focusId, down: 1.5 }, 'down'],
      [{ focusId: 'not-a-uuid' }, 'focusId'],
    ] as const) {
      const r = await api('openapi', '/lineage/ego', query);
      expect(r.status, JSON.stringify(query)).toBe(400);
      expect((r.body.data as { fields: Record<string, string> }).fields[field]).toBeDefined();
    }
    expect((await api('openapi', '/lineage/subtree', { rootId: focusId, depth: 7 })).status).toBe(400);
    expect((await api('openapi', '/lineage/subtree', { rootId: focusId, depth: 0 })).status).toBe(400);
    expect((await api('openapi', '/lineage/paths', { focusId, limit: 201 })).status).toBe(400);
    expect((await api('openapi', '/people/demo-hub-a/students', { page: 0 })).status).toBe(400);
    expect((await api('openapi', '/people/demo-hub-a/students', { page: 1001 })).status).toBe(400);
    expect((await api('openapi', '/people/demo-hub-a/students', { pageSize: 51 })).status).toBe(400);
    expect((await api('openapi', '/people/demo-hub-a/students', { order: 'age' })).status).toBe(400);
  });

  it('a number is digits only: empty, signed, exponent, hex or padded text is a 400, never a silent 0', async () => {
    const focusId = ids['demo-hub-a']!;
    for (const value of ['', '1e1', '0x10', '-1', '+1', ' 5', '5.0', 'NaN', 'Infinity', '00005']) {
      const r = await api('openapi', '/lineage/ego', { focusId, up: value });
      expect(r.status, JSON.stringify(value)).toBe(400);
      expect((r.body.data as { fields: Record<string, string> }).fields.up).toBe('Must be a whole number from 0 to 16.');
    }
    // Digits are read as the number; JSON numbers (/api/rpc) as they are.
    expect((await api('openapi', '/lineage/ego', { focusId, up: '0', down: '1', fanoutLimit: '0007' })).status).toBe(200);
    expect((await api('rpc', '/lineage/ego', { focusId, up: 0, down: 1, fanoutLimit: 7 })).status).toBe(200);
  });
});

describe('privacy for an anonymous visitor (DEFAULT D03)', () => {
  it('demo-claim-only-teacher and other hidden people are in no answer, and asking for them is a plain 404', async () => {
    const hidden = new Set([ids['demo-claim-only-teacher']!, ids['demo-under-review']!, ids['demo-pending']!]);
    const answers = [
      await lineageEgo(null, { focusId: ids['demo-hub-a']!, up: 16, down: 2, fanoutLimit: 100 }),
      await lineageSubtree(null, { rootId: ids['demo-shared-ancestor']!, depth: 6 }),
      await lineageAncestors(null, { focusId: ids['demo-converging']! }),
    ];
    for (const g of answers) {
      for (const n of g.nodes) expect(hidden.has(n.id)).toBe(false);
      for (const e of g.edges) {
        expect(['verified', 'in_arbitration']).toContain(e.status);
        expect(e.visibility).toBe('public');
      }
    }
    const missing = await api('openapi', '/lineage/ego', { focusId: '01900000-0000-7000-8000-000000000000' });
    for (const id of hidden) {
      for (const path of ['/lineage/ego', '/lineage/ancestors', '/lineage/paths']) {
        const r = await api('openapi', path, { focusId: id });
        expect(r).toEqual({ status: 404, body: missing.body });
      }
      expect((await api('openapi', '/lineage/subtree', { rootId: id })).status).toBe(404);
    }
    const hiddenProfile = await api('openapi', '/people/demo-claim-only-teacher', {});
    const missingProfile = await api('openapi', '/people/demo-no-such-person', {});
    expect(hiddenProfile).toEqual(missingProfile);
    expect(hiddenProfile.status).toBe(404);
  });

  it('a pending request to demo-hub-a changes neither its counts nor its hiddenCounts', async () => {
    const before = await lineageEgo(null, { focusId: ids['demo-hub-a']!, up: 1, down: 1, fanoutLimit: 7 });
    const profileBefore = await personProfile(null, { slug: 'demo-hub-a' });
    // demo-pending's request (pending_teacher, involved_only) exists in the seed; add another one,
    // removed again at the end so the later tests see the seeded data.
    const added = await getDb().execute<{ id: string }>(sql`
      INSERT INTO teaching_relationship (id, teacher_person_id, student_person_id, lineage_id, status, visibility)
      SELECT gen_random_uuid(), ${ids['demo-hub-a']}::uuid, ${ids['demo-cjk-name']}::uuid, lineage_id, 'pending_teacher', 'involved_only'
        FROM teaching_relationship WHERE student_person_id = ${ids['demo-hub-a']}::uuid LIMIT 1
      RETURNING id::text AS id`);
    expect(added.rows).toHaveLength(1);
    try {
      const after = await lineageEgo(null, { focusId: ids['demo-hub-a']!, up: 1, down: 1, fanoutLimit: 7 });
      const profileAfter = await personProfile(null, { slug: 'demo-hub-a' });
      expect(after.hiddenCounts).toEqual(before.hiddenCounts);
      expect(after.nodes.find((n) => n.id === ids['demo-hub-a'])).toEqual(before.nodes.find((n) => n.id === ids['demo-hub-a']));
      expect(profileAfter.counts).toEqual(profileBefore.counts);
      expect(after.dataVersion).toBe(before.dataVersion);
    } finally {
      await getDb().execute(sql`DELETE FROM teaching_relationship WHERE id = ${added.rows[0]!.id}::uuid`);
    }
  });
});

describe('the signed-in participant sees their own involved_only relationships, marked', () => {
  it('demo-pending sees its pending request to demo-hub-a, marked involved_only; nobody else does', async () => {
    const me = principalOf(pendingUserId);
    const g = await lineageEgo(me, { focusId: ids['demo-pending']!, up: 2, down: 0, fanoutLimit: 50 });
    const pending = edgeBetween(g, 'demo-hub-a', 'demo-pending')!;
    expect(pending.status).toBe('pending_teacher');
    expect(pending.visibility).toBe('involved_only');
    expect(g.nodes.find((n) => n.id === ids['demo-pending'])!.visibility).toBe('involved_only');
    expect(nodeIds(g).has(ids['demo-root-a']!)).toBe(true);
    // Counts stay public-only for the participant too.
    const anonymous = await lineageEgo(null, { focusId: ids['demo-hub-a']!, up: 1, down: 0, fanoutLimit: 50 });
    const mine = await lineageEgo(me, { focusId: ids['demo-hub-a']!, up: 1, down: 0, fanoutLimit: 50 });
    expect(mine.nodes.find((n) => n.id === ids['demo-hub-a'])!.childCount).toBe(anonymous.nodes.find((n) => n.id === ids['demo-hub-a'])!.childCount);
    // The participant's answer never passes through the cache.
    expect(cache.tags.filter((t) => t === `person:${ids['demo-pending']}`)).toEqual([]);

    // Another signed-in account without a stake sees nothing of it.
    const other = await getDb().execute<{ id: string }>(sql`SELECT claimed_by_user_id::text AS id FROM person WHERE slug = 'demo-two-lineages'`);
    await expect(lineageEgo(principalOf(other.rows[0]!.id), { focusId: ids['demo-pending']!, up: 1, down: 0, fanoutLimit: 50 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('the teacher of the request sees it among their students, on page 1, marked', async () => {
    const page = await personStudents(principalOf(hubUserId), studentsOf('demo-hub-a'));
    const own = page.own.find((s) => s.person.id === ids['demo-pending']);
    expect(own?.edges[0]?.status).toBe('pending_teacher');
    expect(own?.edges[0]?.visibility).toBe('involved_only');
    const anonymous = await personStudents(null, studentsOf('demo-hub-a'));
    expect(anonymous.own).toEqual([]);
    expect(page.activeTotal).toBe(anonymous.activeTotal);
    expect(JSON.stringify(anonymous)).not.toContain(ids['demo-pending']!);
  });

  it('over /api/v1 with a bearer session: the own pending edge is there, for the session only', async () => {
    const { token } = await signIn({ id: pendingUserId, email: 'demo-pending@example.test', password: TEST_PASSWORD, totpSecret: null });
    const mine = await api('openapi', '/lineage/ego', { focusId: ids['demo-pending']!, up: 1, down: 0 }, token);
    expect(mine.status).toBe(200);
    const edges = mine.body.edges as LineageGraphDto['edges'];
    expect(edges.find((e) => e.studentId === ids['demo-pending'])).toMatchObject({ status: 'pending_teacher', visibility: 'involved_only' });
    const profile = await api('openapi', '/people/demo-pending', {}, token);
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({ isOwn: true, visibility: 'involved_only' });
    expect((await api('openapi', '/people/demo-pending', {})).status).toBe(404);
  });
});

describe('statement timeout and database role', () => {
  it('every graph query runs in a transaction that set statement_timeout to 2s first, as app_public_ro', async () => {
    // Records every statement with the pg client (connection) and role that ran it.
    const seen: { client: object; user: string | undefined; text: string }[] = [];
    const realQuery = Client.prototype.query;
    Client.prototype.query = function (this: Client, ...args: unknown[]) {
      const first = args[0];
      const text = typeof first === 'string' ? first : ((first as { text?: string } | undefined)?.text ?? '');
      seen.push({ client: this, user: (this as unknown as { user?: string }).user, text });
      return (realQuery as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof Client.prototype.query;
    try {
      await lineageEgo(null, { focusId: ids['demo-hub-a']!, up: 2, down: 2, fanoutLimit: 20 });
      await lineageAncestors(null, { focusId: ids['demo-converging']! });
      await lineageSubtree(null, { rootId: ids['demo-root-a']!, depth: 3 });
      await lineagePaths(null, { focusId: ids['demo-converging']!, limit: 10 });
      await personStudents(null, studentsOf('demo-hub-a', { page: 2 }));
      await personProfile(null, { slug: 'demo-hub-a' });
    } finally {
      Client.prototype.query = realQuery;
    }
    const state = new Map<object, { inTx: boolean; timeout: boolean }>();
    let graphQueries = 0;
    for (const q of seen) {
      const s = state.get(q.client) ?? { inTx: false, timeout: false };
      const text = q.text.trim().toLowerCase();
      if (text.startsWith('begin')) Object.assign(s, { inTx: true, timeout: false });
      else if (text === "set local statement_timeout = '2s'") s.timeout = s.inTx;
      else if (text.startsWith('commit') || text.startsWith('rollback')) Object.assign(s, { inTx: false, timeout: false });
      else if (text.includes('v_public_')) {
        graphQueries += 1;
        expect(s, q.text.slice(0, 80)).toEqual({ inTx: true, timeout: true });
        // Anonymous answers read through app_public_ro only.
        expect(q.user).toMatch(/app_public_ro/);
      }
      state.set(q.client, s);
    }
    expect(graphQueries).toBeGreaterThan(10);
  });

  it('readTransaction sets the timeout even on a connection whose default is different', async () => {
    // A pool of its own: used one call at a time, it only ever opens one connection.
    const db = createRoleDatabase('app_public_ro', testDb!.url, rolePassword('app_public_ro'));
    try {
      await db.$client.query('SET statement_timeout = 0');
      const inside = await readTransaction(db, async (tx) => (await tx.execute(sql`SELECT current_setting('statement_timeout') AS t`)).rows[0]!.t);
      const after = await db.$client.query<{ t: string }>(`SELECT current_setting('statement_timeout') AS t`);
      expect(db.$client.totalCount).toBe(1);
      expect(inside).toBe('2s');
      // SET LOCAL ends with the transaction: the connection is back to its own setting.
      expect(after.rows[0]!.t).toBe('0');
    } finally {
      await db.$client.end();
    }
  });
});

describe('a failed read: a budget per procedure, and nothing of the query in the error', () => {
  it('the statements of one read share one 2 s budget, so three 0.8 s statements fail as cancelled (57014)', async () => {
    const started = Date.now();
    const error = await readTransaction(getDb(), async (tx) => {
      for (let i = 0; i < 3; i += 1) await tx.execute(sql`SELECT pg_sleep(0.8)`);
      return 'finished';
    }).catch((e: unknown) => e);
    const took = Date.now() - started;
    expect(error).toBeInstanceOf(LineageReadError);
    expect((error as LineageReadError).code).toBe('57014');
    // Per statement, three 0.8 s sleeps would take 2.4 s; the budget stops the read at about 2 s.
    expect(took).toBeLessThan(2_300);
    expect(took).toBeGreaterThanOrEqual(1_900);

    // Transactions given the same deadline share it: a spent budget fails before any statement.
    const deadline = readDeadline(0);
    await expect(readTransaction(getDb(), async () => 'never', deadline)).rejects.toMatchObject({ code: '57014' });
  });

  it('a read that times out behind a lock leaves only its SQLSTATE: no SQL, parameter, user id or slug', async () => {
    const locker = new Client({ connectionString: testDb!.url });
    await locker.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('LOCK TABLE person IN ACCESS EXCLUSIVE MODE');
      const failures = await Promise.all([
        // Signed in: loadViewer reads the account's own person by its user id (app_rw).
        personProfile(principalOf(hubUserId), { slug: 'demo-two-lineages' }).catch((e: unknown) => e),
        // Anonymous: the slug is the parameter of the first query (app_public_ro), and a cached read.
        personStudents(null, studentsOf('demo-hub-a')).catch((e: unknown) => e),
        lineageEgo(null, { focusId: ids['demo-converging']!, up: 1, down: 1, fanoutLimit: 5 }).catch((e: unknown) => e),
      ]);
      for (const error of failures) {
        expect(error).toBeInstanceOf(LineageReadError);
        expect((error as LineageReadError).code).toBe('57014');
        // What Next.js would log for it: the whole error, its own properties and its causes.
        const logged = `${String(error)}\n${inspect(error, { depth: 10, showHidden: true })}\n${JSON.stringify(error)}`;
        for (const secret of [hubUserId, 'demo-two-lineages', 'demo-hub-a', ids['demo-converging']!, 'SELECT', 'params', 'v_public_']) {
          expect(logged, secret).not.toContain(secret);
        }
        expect((error as { cause?: unknown }).cause).toBeUndefined();
      }
    } finally {
      await locker.query('ROLLBACK').catch(() => undefined);
      await locker.end();
    }
  });
});

describe('cache: only public DTOs, tagged by person and lineage', () => {
  it('a cached ego answer carries person:<id> for every node and lineage:<id> for its lineages', async () => {
    const g = (await cachedEgo({ focusId: ids['demo-two-lineages']!, up: 1, down: 0, fanoutLimit: 50 }))!;
    for (const n of g.nodes) expect(cache.tags).toContain(`person:${n.id}`);
    for (const l of g.lineages) expect(cache.tags).toContain(`lineage:${l.id}`);
  });

  it('a subtree carries lineage:<rootId>; a profile lineage:<personId>; a hidden id still person:<id>', async () => {
    await cachedSubtree({ rootId: ids['demo-root-a']!, lineageId: null, depth: 1 });
    expect(cache.tags).toContain(`lineage:${ids['demo-root-a']}`);
    cache.tags.length = 0;
    await cachedProfile(ids['demo-hub-a']!);
    expect(cache.tags).toEqual(expect.arrayContaining([`person:${ids['demo-hub-a']}`, `lineage:${ids['demo-hub-a']}`]));
    cache.tags.length = 0;
    expect(await cachedEgo({ focusId: ids['demo-claim-only-teacher']!, up: 1, down: 1, fanoutLimit: 5 })).toBeNull();
    expect(cache.tags).toEqual([`person:${ids['demo-claim-only-teacher']}`]);
  });

  it('a public DTO drops any key its schema does not name', async () => {
    const { toPublicGraph } = await import('../dto/public');
    const g = await lineageEgo(null, { focusId: ids['demo-two-lineages']!, up: 1, down: 0, fanoutLimit: 50 });
    const leaked = { ...g, nodes: g.nodes.map((n) => ({ ...n, birthDate: '1970-01-01', claimedByUserId: 'x' })) };
    const clean = toPublicGraph(leaked as LineageGraphDto);
    expect(JSON.stringify(clean)).not.toContain('birthDate');
    expect(JSON.stringify(clean)).not.toContain('claimedByUserId');
  });
});

describe('the same procedures over /api/v1 and /api/rpc', () => {
  it('lineage.ego answers the same through both handlers', async () => {
    const query = { focusId: ids['demo-converging']!, up: 3, down: 1, fanoutLimit: 5 };
    const v1 = await api('openapi', '/lineage/ego', query);
    const rpc = await api('rpc', '/lineage/ego', query);
    expect(v1.status).toBe(200);
    expect(rpc.status).toBe(200);
    expect(rpc.body).toEqual(v1.body);
  });

  it('people.get and people.students answer over /api/v1', async () => {
    const profile = await api('openapi', '/people/demo-two-lineages', {});
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({ slug: 'demo-two-lineages', isOwn: false, visibility: 'public' });
    expect((profile.body.counts as { teachers: number }).teachers).toBe(2);
    const students = await api('openapi', '/people/demo-hub-a/students', { page: 2 });
    expect(students.status).toBe(200);
    expect(students.body.page).toBe(2);
  });

  it('pnpm api:openapi --check: docs/api/openapi.json matches the router', async () => {
    const committed = await readFile(resolve(process.cwd(), OPENAPI_FILE), 'utf8');
    expect(committed).toBe(await openApiJson());
    const doc = JSON.parse(committed) as { paths: Record<string, unknown> };
    for (const path of ['/lineage/ego', '/lineage/ancestors', '/lineage/subtree', '/lineage/paths', '/people/{slug}', '/account/me']) {
      expect(Object.keys(doc.paths)).toContain(path);
    }
  });
});

// --- Fixtures of their own: fictional demo- people, added for one describe and removed after it --

interface FixturePerson {
  slug: string;
  name: string;
  visibility?: 'public' | 'involved_only';
  createdBy?: string | null;
}

interface FixtureEdge {
  teacher: string;
  student: string;
  status?: string;
  visibility?: 'public' | 'involved_only';
  primary?: boolean;
  requestedBy?: string | null;
  /** [starts_on, precision] of one training period. */
  period?: [string | null, 'year' | 'month' | 'day' | 'unknown'];
}

/** Adds people (with a primary Latin name) and relationships in lineage A; returns slug → id and a cleanup. */
async function addFixture(people: FixturePerson[], edges: FixtureEdge[]): Promise<{ id: Record<string, string>; remove: () => Promise<void> }> {
  const db = getDb();
  const rows = await db.execute<{ slug: string; id: string }>(sql`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(
        people.map((p) => ({ slug: p.slug, name: p.name, visibility: p.visibility ?? 'public', created_by: p.createdBy ?? null })),
      )}::jsonb) AS x(slug text, name text, visibility text, created_by uuid)
    ),
    p AS (
      INSERT INTO person (slug, kind, life_status, visibility, created_by_user_id)
      SELECT slug, 'living', 'living', visibility, created_by FROM input
      RETURNING id, slug
    ),
    n AS (
      INSERT INTO person_name (person_id, value, script, lang, is_primary)
      SELECT p.id, input.name, 'Latn', 'en', true FROM p JOIN input USING (slug)
    )
    SELECT slug, id::text AS id FROM p`);
  const id: Record<string, string> = { ...ids };
  for (const r of rows.rows) id[r.slug] = r.id;
  const personIds = rows.rows.map((r) => r.id);
  const lineage = await db.execute<{ id: string }>(sql`SELECT id::text AS id FROM lineage WHERE slug = 'demo-lineage-a'`);
  const edgeIds: string[] = [];
  // In chunks: one statement per 500 edges keeps the parameter small.
  for (let i = 0; i < edges.length; i += 500) {
    const chunk = edges.slice(i, i + 500).map((e) => ({
      teacher: id[e.teacher],
      student: id[e.student],
      status: e.status ?? 'verified',
      visibility: e.visibility ?? 'public',
      primary: e.primary ?? false,
      requested_by: e.requestedBy ?? null,
      starts_on: e.period?.[0] ?? null,
      precision: e.period?.[1] ?? null,
    }));
    const inserted = await db.execute<{ id: string }>(sql`
      WITH input AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb)
          AS x(teacher uuid, student uuid, status text, visibility text, "primary" boolean, requested_by uuid, starts_on date, precision text)
      ),
      r AS (
        INSERT INTO teaching_relationship (teacher_person_id, student_person_id, lineage_id, status, visibility, is_display_primary, requested_by_user_id)
        SELECT teacher, student, ${lineage.rows[0]!.id}::uuid, status, visibility, "primary", requested_by FROM input
        RETURNING id, teacher_person_id, student_person_id
      ),
      t AS (
        INSERT INTO training_period (relationship_id, starts_on, precision, ongoing)
        SELECT r.id, input.starts_on, input.precision, true
          FROM r JOIN input ON input.teacher = r.teacher_person_id AND input.student = r.student_person_id
         WHERE input.precision IS NOT NULL
      )
      SELECT id::text AS id FROM r`);
    edgeIds.push(...inserted.rows.map((r) => r.id));
  }
  return {
    id,
    remove: async () => {
      await db.execute(sql`DELETE FROM training_period WHERE relationship_id = ANY(${`{${edgeIds.join(',')}}`}::uuid[])`);
      await db.execute(sql`DELETE FROM teaching_relationship WHERE id = ANY(${`{${edgeIds.join(',')}}`}::uuid[])`);
      await db.execute(sql`DELETE FROM person WHERE id = ANY(${`{${personIds.join(',')}}`}::uuid[])`);
    },
  };
}

describe('a crossed ladder of 20 generations: routes stay within budget', () => {
  // Every person of generation g has both people of generation g - 1 as teachers: 2^21 routes.
  const people: FixturePerson[] = [{ slug: 'demo-ladder-focus', name: 'Ladder Focus Notreal' }];
  const edges: FixtureEdge[] = [];
  for (let g = 0; g <= 20; g += 1) {
    for (const side of ['l', 'r']) {
      people.push({ slug: `demo-ladder-${g}-${side}`, name: `Ladder ${side.toUpperCase()}${g} Notreal` });
      if (g > 0) {
        edges.push({ teacher: `demo-ladder-${g - 1}-l`, student: `demo-ladder-${g}-${side}`, primary: side === 'l' });
        edges.push({ teacher: `demo-ladder-${g - 1}-r`, student: `demo-ladder-${g}-${side}`, primary: side === 'r' });
      }
    }
  }
  edges.push({ teacher: 'demo-ladder-20-l', student: 'demo-ladder-focus', primary: true }, { teacher: 'demo-ladder-20-r', student: 'demo-ladder-focus' });
  let fixture: Awaited<ReturnType<typeof addFixture>>;
  beforeAll(async () => {
    fixture = await addFixture(people, edges);
  });
  afterAll(async () => {
    await fixture.remove();
  });

  it('paths answers well inside 2 s, says there are more routes, and puts the primary route first', async () => {
    const started = Date.now();
    const p = await lineagePaths(null, { focusId: fixture.id['demo-ladder-focus']!, limit: 10 });
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(p.totalPathsCapped).toBe(true);
    expect(p.totalPaths).toBe(1000);
    expect(p.paths).toHaveLength(10);
    const slugOf = (id: string) => p.nodes.find((n) => n.id === id)!.slug;
    // The route along display-primary teachers only: the left side all the way up.
    expect(p.paths[0]!.personIds.map(slugOf)).toEqual([...Array.from({ length: 21 }, (_, g) => `demo-ladder-${g}-l`), 'demo-ladder-focus']);
    for (const route of p.paths) expect(route.personIds).toHaveLength(22);
  });
});

describe('the cap on a wide ego network (more than 500 people within 4 generations)', () => {
  // 1 + 8 + 64 + 512 people: each person teaches 8.
  const people: FixturePerson[] = [];
  const edges: FixtureEdge[] = [];
  const width = [1, 8, 64, 512];
  for (let g = 0; g < width.length; g += 1) {
    for (let i = 1; i <= width[g]!; i += 1) {
      people.push({ slug: `demo-cap-${g}-${i}`, name: `Cap ${g}-${String(i).padStart(3, '0')} Notreal` });
      if (g > 0) edges.push({ teacher: `demo-cap-${g - 1}-${Math.ceil(i / 8)}`, student: `demo-cap-${g}-${i}` });
    }
  }
  let fixture: Awaited<ReturnType<typeof addFixture>>;
  beforeAll(async () => {
    fixture = await addFixture(people, edges);
  });
  afterAll(async () => {
    await fixture.remove();
  });

  it('lineage.ego stops at exactly 500 people, generation by generation, and counts the rest', async () => {
    const g = await lineageEgo(null, { focusId: fixture.id['demo-cap-0-1']!, up: 0, down: 4, fanoutLimit: 100 });
    expect(g.truncated).toBe(true);
    expect(g.nodes).toHaveLength(500);
    const generation = (slug: string) => Number(slug.split('-')[2]);
    const perGeneration = [0, 1, 2, 3].map((n) => g.nodes.filter((x) => generation(x.slug) === n).length);
    // Nearer generations first: all of 0-2, and the cap's remainder of generation 3.
    expect(perGeneration).toEqual([1, 8, 64, 500 - 73]);
    expectCountsAddUp(g);
    // The boundary generation's teachers report the students the cap left out.
    const hiddenAtBoundary = g.nodes.filter((x) => generation(x.slug) === 2).reduce((sum, x) => sum + (g.hiddenCounts[x.id]?.students ?? 0), 0);
    expect(hiddenAtBoundary).toBe(512 - (500 - 73));

    const sub = await lineageSubtree(null, { rootId: fixture.id['demo-cap-0-1']!, depth: 3 });
    expect(sub.truncated).toBe(true);
    expect(sub.nodes).toHaveLength(500);
    expectCountsAddUp(sub);
  });
});

describe('order of students: one alphabet (ICU) and seniority, and the other teachers named', () => {
  const people: FixturePerson[] = [
    { slug: 'demo-order-teacher', name: 'Order Teacher Notreal' },
    { slug: 'demo-order-zed', name: 'Zed Notreal' },
    { slug: 'demo-order-van', name: 'van Dam Notreal' },
    { slug: 'demo-order-emile', name: 'Émile Notreal' },
    { slug: 'demo-order-adam', name: 'Adam Notreal' },
    { slug: 'demo-order-vega', name: 'Vega Notreal' },
  ];
  const edges: FixtureEdge[] = [
    { teacher: 'demo-order-teacher', student: 'demo-order-zed', period: ['1990-01-01', 'year'] },
    { teacher: 'demo-order-teacher', student: 'demo-order-van' },
    { teacher: 'demo-order-teacher', student: 'demo-order-emile', period: ['1985-03-04', 'day'] },
    { teacher: 'demo-order-teacher', student: 'demo-order-adam', period: ['2001-01-01', 'year'] },
    // A period of unknown date sorts with the undated.
    { teacher: 'demo-order-teacher', student: 'demo-order-vega', period: [null, 'unknown'] },
  ];
  let fixture: Awaited<ReturnType<typeof addFixture>>;
  beforeAll(async () => {
    fixture = await addFixture(people, edges);
  });
  afterAll(async () => {
    await fixture.remove();
  });

  it('by name: a particle and an accent sort where a reader expects them, in people.students and in ego', async () => {
    const page = await personStudents(null, studentsOf('demo-order-teacher'));
    expect(page.order).toBe('name');
    expect(page.active.map((s) => s.person.displayName)).toEqual(['Adam Notreal', 'Émile Notreal', 'van Dam Notreal', 'Vega Notreal', 'Zed Notreal']);
    const ego = await lineageEgo(null, { focusId: fixture.id['demo-order-teacher']!, up: 0, down: 1, fanoutLimit: 2 });
    expect(slugsOf(ego)).toEqual(['demo-order-adam', 'demo-order-emile', 'demo-order-teacher']);
  });

  it('by seniority: the earliest dated training first, undated last by name, paged', async () => {
    const first = await personStudents(null, studentsOf('demo-order-teacher', { order: 'seniority', pageSize: 2 }));
    expect(first).toMatchObject({ order: 'seniority', pageSize: 2, pageCount: 3, activeTotal: 5, historicalTotal: 0 });
    expect(first.active.map((s) => s.person.slug)).toEqual(['demo-order-emile', 'demo-order-zed']);
    const rest = await Promise.all([2, 3].map((page) => personStudents(null, studentsOf('demo-order-teacher', { order: 'seniority', pageSize: 2, page }))));
    expect(rest.flatMap((p) => p.active.map((s) => s.person.slug))).toEqual(['demo-order-adam', 'demo-order-van', 'demo-order-vega']);
    // Past the last page: no rows, the same totals.
    const past = await personStudents(null, studentsOf('demo-order-teacher', { order: 'seniority', pageSize: 2, page: 9 }));
    expect(past).toMatchObject({ active: [], historical: [], activeTotal: 5, historicalTotal: 0 });
  });

  it("a student's other teachers are named on their row, the same on every teacher's page", async () => {
    const page = await personStudents(null, studentsOf('demo-a-001'));
    const entry = [...page.active, ...page.historical].find((s) => s.person.id === ids['demo-two-lineages'])!;
    expect(entry.otherTeachersTotal).toBe(1);
    expect(entry.otherTeachers.map((t) => t.person.slug)).toEqual(['demo-b-001']);
    const lineageB = page.lineages.find((l) => l.slug === 'demo-lineage-b')!;
    expect(entry.otherTeachers[0]!.lineageId).toBe(lineageB.id);
    const fromB = await personStudents(null, studentsOf('demo-b-001'));
    const sameStudent = [...fromB.active, ...fromB.historical].find((s) => s.person.id === ids['demo-two-lineages'])!;
    expect(sameStudent.otherTeachers.map((t) => t.person.slug)).toEqual(['demo-a-001']);
    // studentCount: the student's own public students.
    const hub = (await personStudents(null, studentsOf('demo-root-a'))).active.find((s) => s.person.id === ids['demo-hub-a'])!;
    const hubStudents = await getDb().execute<{ n: number }>(
      sql`SELECT count(DISTINCT student_person_id)::int AS n FROM v_public_edge WHERE teacher_person_id = ${ids['demo-hub-a']}::uuid`,
    );
    expect(hub.studentCount).toBe(hubStudents.rows[0]!.n);
  });
});

describe('the other end of an unanswered request shows only its names (plan §6.4)', () => {
  let viewerUserId: string;
  let fixture: Awaited<ReturnType<typeof addFixture>>;
  beforeAll(async () => {
    const viewer = await getDb().execute<{ id: string }>(sql`SELECT claimed_by_user_id::text AS id FROM person WHERE slug = 'demo-two-lineages'`);
    viewerUserId = viewer.rows[0]!.id;
    fixture = await addFixture(
      [
        { slug: 'demo-limited-teacher', name: 'Limited Teacher Notreal', visibility: 'involved_only' },
        { slug: 'demo-answered-teacher', name: 'Answered Teacher Notreal', visibility: 'involved_only' },
      ],
      [
        // The viewer asked; nobody has answered.
        { teacher: 'demo-limited-teacher', student: 'demo-two-lineages', status: 'pending_teacher', visibility: 'involved_only', requestedBy: viewerUserId },
        // Under review: the teacher has confirmed it.
        { teacher: 'demo-answered-teacher', student: 'demo-two-lineages', status: 'under_review', visibility: 'involved_only', requestedBy: viewerUserId },
      ],
    );
    for (const slug of ['demo-limited-teacher', 'demo-answered-teacher']) {
      await getDb().execute(sql`UPDATE person SET country_code = 'GB', life_status = 'deceased' WHERE id = ${fixture.id[slug]}::uuid`);
      await getDb().execute(sql`INSERT INTO person_bio (person_id, lang, body) VALUES (${fixture.id[slug]}::uuid, 'en', 'A fictional biography.')`);
    }
  });
  afterAll(async () => {
    await getDb().execute(sql`DELETE FROM person_bio WHERE body = 'A fictional biography.'`);
    await fixture.remove();
  });

  it('names only for the unanswered request; the full record once answered, or when the viewer wrote it', async () => {
    const me = principalOf(viewerUserId);
    const limited = await personProfile(me, { slug: 'demo-limited-teacher' });
    expect(limited).toMatchObject({ limited: true, displayName: 'Limited Teacher Notreal', bio: null, countryCode: null, cityName: null, lifeStatus: 'unknown' });
    const answered = await personProfile(me, { slug: 'demo-answered-teacher' });
    expect(answered).toMatchObject({ limited: false, bio: 'A fictional biography.', countryCode: 'GB', lifeStatus: 'deceased' });
    // The graph shows the same: a name, no life status.
    const ego = await lineageEgo(me, { focusId: ids['demo-two-lineages']!, up: 1, down: 0, fanoutLimit: 50 });
    expect(ego.nodes.find((n) => n.slug === 'demo-limited-teacher')).toMatchObject({ displayName: 'Limited Teacher Notreal', lifeStatus: 'unknown' });

    await getDb().execute(sql`UPDATE person SET created_by_user_id = ${viewerUserId}::uuid WHERE id = ${fixture.id['demo-limited-teacher']}::uuid`);
    try {
      expect(await personProfile(me, { slug: 'demo-limited-teacher' })).toMatchObject({ limited: false, bio: 'A fictional biography.' });
    } finally {
      await getDb().execute(sql`UPDATE person SET created_by_user_id = NULL WHERE id = ${fixture.id['demo-limited-teacher']}::uuid`);
    }
    // Anyone else: not found.
    await expect(personProfile(null, { slug: 'demo-limited-teacher' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('small guarantees of the answers', () => {
  it('an own edge that is also public (read in two snapshots) is in the answer once, as public', async () => {
    const edge = await getDb().execute<{ id: string; lineage_id: string }>(sql`
      SELECT id::text AS id, lineage_id::text AS lineage_id FROM v_public_edge
       WHERE teacher_person_id = ${ids['demo-a-001']}::uuid AND student_person_id = ${ids['demo-two-lineages']}::uuid`);
    const publicEdge = edge.rows[0]!;
    const extras = {
      personId: ids['demo-two-lineages']!,
      nodes: {},
      edges: [
        {
          id: publicEdge.id,
          teacherId: ids['demo-a-001']!,
          studentId: ids['demo-two-lineages']!,
          lineage: { id: publicEdge.lineage_id, slug: 'demo-lineage-a', name: 'Demo Lineage A', rootPersonId: null },
          status: 'verified' as const,
          isDisplayPrimary: true,
          periods: [],
        },
      ],
    };
    const { egoGraph, pathsGraph } = await import('./lineage-graph');
    const { getPublicDb } = await import('../db');
    const ego = await readTransaction(getPublicDb(), (tx) => egoGraph(tx, { focusId: ids['demo-two-lineages']!, up: 1, down: 0, fanoutLimit: 50 }, extras));
    expect(ego.edges.filter((e) => e.id === publicEdge.id)).toEqual([expect.objectContaining({ visibility: 'public' })]);
    const paths = await readTransaction(getPublicDb(), (tx) => pathsGraph(tx, { focusId: ids['demo-two-lineages']!, limit: 50 }, extras));
    expect(paths.totalPaths).toBe(2);
  });

  it('a cached paths answer carries everyone on every route counted, not only the routes it returns', async () => {
    const { cachedPaths } = await import('./lineage-public');
    const p = (await cachedPaths({ focusId: ids['demo-converging']!, limit: 1 }))!;
    expect(p.paths).toHaveLength(1);
    expect(p.totalPaths).toBe(2);
    expect(p.nodes.some((n) => n.id === ids['demo-a-002'])).toBe(false);
    expect(cache.tags).toContain(`person:${ids['demo-a-002']}`);
    expect(JSON.stringify(p)).not.toContain('routePersonIds');
  });

  it('people.get gives the city by name only, never a point', async () => {
    const place = await getDb().execute<{ id: string; name: string }>(sql`SELECT id::text AS id, name FROM place ORDER BY name LIMIT 1`);
    await getDb().execute(sql`UPDATE person SET place_id = ${place.rows[0]!.id}::uuid WHERE id = ${ids['demo-cjk-name']}::uuid`);
    try {
      const r = await api('openapi', '/people/demo-cjk-name', {});
      expect(r.status).toBe(200);
      expect(r.body.cityName).toBe(place.rows[0]!.name);
      const text = JSON.stringify(r.body);
      for (const key of ['centroid', 'latitude', 'longitude', 'lat', 'lng', 'geonames', 'POINT', 'coordinates']) expect(text).not.toContain(key);
    } finally {
      await getDb().execute(sql`UPDATE person SET place_id = NULL WHERE id = ${ids['demo-cjk-name']}::uuid`);
    }
  });

  it('the contract documents the 400 and the 404, and the error body has the documented shape', async () => {
    const doc = JSON.parse(await openApiJson()) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: { Error: { required: string[] } }; securitySchemes: Record<string, unknown> };
    };
    for (const path of ['/lineage/ego', '/lineage/ancestors', '/lineage/subtree', '/lineage/paths', '/people/{slug}', '/people/{slug}/students']) {
      expect(Object.keys(doc.paths[path]!.get!.responses).sort(), path).toEqual(['200', '400', '404']);
    }
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(['bearer', 'cookie']);
    const notFound = await api('openapi', '/people/demo-no-such-person', {});
    const badRequest = await api('openapi', '/lineage/ego', { focusId: 'x' });
    for (const body of [notFound.body, badRequest.body]) {
      for (const key of doc.components.schemas.Error.required) expect(body).toHaveProperty(key);
    }
    expect(notFound.body).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
