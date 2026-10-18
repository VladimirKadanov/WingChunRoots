// The lineage API (milestone M04, Done when 3): ego, ancestors, subtree and paths against the
// seeded demo fixture (src/fixtures), privacy for anonymous and involved viewers (DEFAULT D03),
// the statement timeout, the caps, the cache tags, and the same answer over /api/v1 and /api/rpc.
// Runs against a throwaway database, seeded with the demo data.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
import { readTransaction } from './lineage-graph';
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
const slugsOf = (g: { nodes: { slug: string }[] }) => g.nodes.map((n) => n.slug).sort();
const edgeBetween = (g: LineageGraphDto, teacher: string, student: string) =>
  g.edges.find((e) => e.teacherId === ids[teacher] && e.studentId === ids[student]);

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
    const g = await lineageEgo(null, { focusId: ids['demo-root-a']!, up: 16, down: 2, fanoutLimit: 50 });
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
    const n = nodeIds(g);
    for (const slug of ['demo-hub-a', 'demo-a-001', 'demo-a-002', 'demo-converging', 'demo-two-lineages']) expect(n.has(ids[slug]!)).toBe(true);
    expect(n.has(ids['demo-shared-ancestor']!)).toBe(false);
    // demo-converging has two teachers in this subtree: both edges are there.
    expect(edgeBetween(g, 'demo-hub-a', 'demo-converging')).toBeDefined();
    expect(edgeBetween(g, 'demo-a-002', 'demo-converging')).toBeDefined();

    const b = await lineageSubtree(null, { rootId: ids['demo-shared-ancestor']!, depth: 2, lineageId: g.lineages.find((l) => l.slug === 'demo-lineage-b')!.id });
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

  it('no answer has more than about 500 people', async () => {
    const g = await lineageSubtree(null, { rootId: ids['demo-shared-ancestor']!, depth: 6 });
    expect(g.nodes.length).toBeLessThanOrEqual(500);
    const e = await lineageEgo(null, { focusId: ids['demo-shared-ancestor']!, up: 16, down: 4, fanoutLimit: 100 });
    expect(e.nodes.length).toBeLessThanOrEqual(500);
    expect(e.truncated).toBe(e.nodes.length === 500);
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
    const page = await personStudents(principalOf(hubUserId), { slug: 'demo-hub-a', page: 1 });
    const own = page.own.find((s) => s.person.id === ids['demo-pending']);
    expect(own?.edges[0]?.status).toBe('pending_teacher');
    expect(own?.edges[0]?.visibility).toBe('involved_only');
    const anonymous = await personStudents(null, { slug: 'demo-hub-a', page: 1 });
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
      await personStudents(null, { slug: 'demo-hub-a', page: 2 });
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
