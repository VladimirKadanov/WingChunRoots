// lineage.start (milestone M05): the explorer's starting points, a cached public read with a
// public number in it (each lineage's people). The guards M04 set for every other public read
// (lineage.int.test.ts), for this one: only public people with a public relationship are counted,
// so a hidden person and a relationship that is not public never change a public number (plan
// §6.2, §4.14; DEFAULT D03); a lineage whose root is not public is not offered (DEFAULT D22); the
// read goes through app_public_ro; the cached answer carries explore-start (the tag every change
// of visibility clears, docs/api/lineage.md §6.1), lineage:<id> and person:<root>; the DTO
// strips what it does not name; and /api/v1 and /api/rpc give the same answer.
// Runs against a throwaway database, seeded with the demo data.

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv, TEST_APP_URL } from '../auth/test-support';
import { closeDb, getDb } from '../db';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { type ExploreStartDto, toPublicExploreStart } from '../dto/explore';
import { stopProducer } from '../jobs/boss';
import { handleApiRequest } from '../rpc/handler';
import { exploreStart } from './explore-start';

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
const lineageIds: Record<string, string> = {};

const SLUGS = ['demo-hub-a', 'demo-pending', 'demo-claim-only-teacher', 'demo-under-review'];
const LINEAGES = ['demo-lineage-a', 'demo-lineage-b', 'demo-lineage-c'];

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
  const people = await getDb().execute<{ slug: string; id: string }>(
    sql`SELECT slug, id::text AS id FROM person WHERE slug = ANY(${`{${SLUGS.join(',')}}`}::text[])`,
  );
  for (const r of people.rows) ids[r.slug] = r.id;
  expect(Object.keys(ids).sort()).toEqual([...SLUGS].sort());
  const lineages = await getDb().execute<{ slug: string; id: string }>(sql`SELECT slug, id::text AS id FROM lineage`);
  for (const r of lineages.rows) lineageIds[r.slug] = r.id;
  expect(Object.keys(lineageIds).sort()).toEqual(LINEAGES);
});

afterAll(async () => {
  await stopProducer();
  await closeDb();
  await testDb?.drop();
});

beforeEach(() => {
  cache.tags.length = 0;
});

const peopleOf = (start: ExploreStartDto) => Object.fromEntries(start.lineages.map((l) => [l.slug, l.people]));

/** Members of each lineage by an independent query: distinct public people at either end of a public edge. */
async function publicMembers(): Promise<Record<string, number>> {
  const r = await getDb().execute<{ slug: string; people: number }>(sql`
    SELECT lineage_slug AS slug, count(DISTINCT pid)::int AS people FROM (
      SELECT lineage_slug, teacher_person_id AS pid FROM v_public_edge
      UNION ALL
      SELECT lineage_slug, student_person_id FROM v_public_edge) m
     GROUP BY lineage_slug`);
  return Object.fromEntries(r.rows.map((x) => [x.slug, x.people]));
}

/** Every person with any relationship of any status in each lineage: what a leaking count would say. */
async function everyMember(): Promise<Record<string, number>> {
  const r = await getDb().execute<{ slug: string; people: number }>(sql`
    SELECT l.slug, count(DISTINCT pid)::int AS people FROM (
      SELECT lineage_id, teacher_person_id AS pid FROM teaching_relationship
      UNION ALL
      SELECT lineage_id, student_person_id FROM teaching_relationship) m
      JOIN lineage l ON l.id = m.lineage_id
     GROUP BY l.slug`);
  return Object.fromEntries(r.rows.map((x) => [x.slug, x.people]));
}

/** Public people with no relationship at all in `lineageSlug`, in a fixed order. */
async function publicOutsiders(lineageSlug: string, n: number): Promise<string[]> {
  const r = await getDb().execute<{ id: string }>(sql`
    SELECT p.id::text AS id FROM v_public_person p
     WHERE NOT EXISTS (
       SELECT 1 FROM teaching_relationship t JOIN lineage l ON l.id = t.lineage_id
        WHERE l.slug = ${lineageSlug} AND p.id IN (t.teacher_person_id, t.student_person_id))
     ORDER BY p.slug LIMIT ${n}`);
  expect(r.rows).toHaveLength(n);
  return r.rows.map((x) => x.id);
}

async function api(kind: 'openapi' | 'rpc') {
  const request =
    kind === 'openapi'
      ? new Request(`${TEST_APP_URL}/api/v1/lineage/start`, { method: 'GET' })
      : new Request(`${TEST_APP_URL}/api/rpc/lineage/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ json: {} }),
        });
  const response = await handleApiRequest(request, kind);
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: kind === 'rpc' ? body.json : body };
}

describe('lineage.start: the public counts', () => {
  it('offers every demo lineage with its public root and counts each public person with a public relationship in it once', async () => {
    const start = await exploreStart();
    expect(start.lineages.map((l) => l.slug).sort()).toEqual(LINEAGES);
    expect(peopleOf(start)).toEqual(await publicMembers());
    for (const l of start.lineages) {
      const root = await getDb().execute<{ slug: string; display_name: string }>(
        sql`SELECT slug, display_name FROM v_public_person WHERE id = ${l.root.id}::uuid`,
      );
      expect(root.rows).toEqual([{ slug: l.root.slug, display_name: l.root.displayName }]);
    }
    // Not a vacuous check: the seed has hidden people and private requests in lineages a and c
    // (demo-pending, demo-claim-only-teacher, demo-under-review), which a count over every
    // relationship would include.
    const leaking = await everyMember();
    expect(leaking['demo-lineage-a']).toBeGreaterThan(peopleOf(start)['demo-lineage-a']!);
    expect(leaking['demo-lineage-c']).toBeGreaterThan(peopleOf(start)['demo-lineage-c']!);
  });

  it('a hidden person, a pending request, a verified but private relationship and a revoked one change no public number', async () => {
    const before = await exploreStart();
    const leakingBefore = await everyMember();
    const [pending, privateOne, revoked, ofHidden] = await publicOutsiders('demo-lineage-a', 4);
    const lineage = lineageIds['demo-lineage-a']!;
    const added = await getDb().execute<{ id: string }>(sql`
      INSERT INTO teaching_relationship (id, teacher_person_id, student_person_id, lineage_id, status, visibility)
      VALUES (gen_random_uuid(), ${ids['demo-hub-a']}::uuid, ${pending}::uuid, ${lineage}::uuid, 'pending_teacher', 'involved_only'),
             (gen_random_uuid(), ${ids['demo-hub-a']}::uuid, ${privateOne}::uuid, ${lineage}::uuid, 'verified', 'involved_only'),
             (gen_random_uuid(), ${ids['demo-hub-a']}::uuid, ${revoked}::uuid, ${lineage}::uuid, 'revoked', 'public'),
             (gen_random_uuid(), ${ids['demo-claim-only-teacher']}::uuid, ${ofHidden}::uuid, ${lineage}::uuid, 'verified', 'public')
      RETURNING id::text AS id`);
    expect(added.rows).toHaveLength(4);
    try {
      // A count over every relationship would now say five more people (four students, the hidden teacher).
      expect((await everyMember())['demo-lineage-a']).toBeGreaterThan(leakingBefore['demo-lineage-a']!);
      const after = await exploreStart();
      expect(after).toEqual(before);
      expect(peopleOf(after)).toEqual(await publicMembers());
    } finally {
      await getDb().execute(sql`DELETE FROM teaching_relationship WHERE id = ANY(${`{${added.rows.map((r) => r.id).join(',')}}`}::uuid[])`);
    }
  });

  it('a lineage whose root is hidden, or unknown, is not offered (DEFAULT D22); the others stay as they were', async () => {
    const before = await exploreStart();
    const roots = await getDb().execute<{ slug: string; root: string | null }>(sql`SELECT slug, root_person_id::text AS root FROM lineage`);
    try {
      await getDb().execute(sql`UPDATE lineage SET root_person_id = ${ids['demo-claim-only-teacher']}::uuid WHERE slug = 'demo-lineage-c'`);
      await getDb().execute(sql`UPDATE lineage SET root_person_id = NULL WHERE slug = 'demo-lineage-b'`);
      const after = await exploreStart();
      expect(after.lineages).toEqual(before.lineages.filter((l) => l.slug === 'demo-lineage-a'));
      expect(JSON.stringify(after)).not.toContain(ids['demo-claim-only-teacher']!);
    } finally {
      for (const r of roots.rows) {
        await getDb().execute(sql`UPDATE lineage SET root_person_id = ${r.root}::uuid WHERE slug = ${r.slug}`);
      }
    }
    expect(await exploreStart()).toEqual(before);
  });
});

describe('lineage.start: role, cache, DTO and the two entries', () => {
  it('reads through app_public_ro, from the public views only', async () => {
    const seen: { user: string | undefined; text: string }[] = [];
    const realQuery = Client.prototype.query;
    Client.prototype.query = function (this: Client, ...args: unknown[]) {
      const first = args[0];
      const text = typeof first === 'string' ? first : ((first as { text?: string } | undefined)?.text ?? '');
      seen.push({ user: (this as unknown as { user?: string }).user, text });
      return (realQuery as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof Client.prototype.query;
    try {
      await exploreStart();
    } finally {
      Client.prototype.query = realQuery;
    }
    const reads = seen.filter((q) => /\bfrom\b/i.test(q.text));
    expect(reads.length).toBeGreaterThan(0);
    for (const q of reads) {
      expect(q.user).toMatch(/app_public_ro/);
      expect(q.text).toContain('v_public_edge');
      expect(q.text).not.toMatch(/\b(teaching_relationship|lineage_membership|person_name)\b/);
    }
  });

  it('the cached answer carries explore-start, lineage:<id> for every lineage and person:<root> for every root', async () => {
    const start = await exploreStart();
    expect(start.lineages.length).toBeGreaterThan(0);
    expect(cache.tags).toContain('explore-start');
    for (const l of start.lineages) {
      expect(cache.tags).toContain(`lineage:${l.id}`);
      expect(cache.tags).toContain(`person:${l.root.id}`);
    }
  });

  it('the public DTO drops any key its schema does not name', async () => {
    const start = await exploreStart();
    const leaked = {
      ...start,
      viewer: 'someone',
      lineages: start.lineages.map((l) => ({ ...l, membersWithRequests: 99, root: { ...l.root, claimedByUserId: 'x', visibility: 'involved_only' } })),
    };
    const clean = toPublicExploreStart(leaked as ExploreStartDto);
    expect(clean).toEqual(start);
    for (const key of ['viewer', 'membersWithRequests', 'claimedByUserId', 'visibility']) expect(JSON.stringify(clean)).not.toContain(key);
  });

  it('GET /api/v1/lineage/start and /api/rpc answer the same as the service', async () => {
    const v1 = await api('openapi');
    const rpc = await api('rpc');
    expect(v1.status).toBe(200);
    expect(rpc.status).toBe(200);
    expect(rpc.body).toEqual(v1.body);
    expect(v1.body).toEqual(await exploreStart());
  });

  it('the test fault lineage-once fails the read once, for the error state of /explore (WCR_TEST_FAULTS)', async () => {
    const meta = { requestId: 'test', ipHmac: null, testFault: { kind: 'lineage-once' as const, token: randomUUID() } };
    await expect(exploreStart(meta)).rejects.toThrow(/Test fault/);
    expect((await exploreStart(meta)).lineages.length).toBeGreaterThan(0);
  });
});
