// The server contract of the explorer's expansion (milestone M06, package C; plan §4.8): "+N
// students" reads lineage.ego with { up: 0, down: 1 }, "+N teachers" with { up: 1, down: 0 }, both
// at the default fan-out limit (50), and the summary node "and N more" opens people.students in
// pages of 20. No new procedure: these are M04's, against the seeded demo data. The five cases of
// the M06 plan, section (c):
//   1. the students of demo-hub-a: the first 50, their edges, the count of the rest, the schema;
//   2. the teachers of demo-two-lineages: both, one of them cross-lineage, none left out;
//   3. the cached read and an uncached one agree on the expansion inputs (anonymous);
//   4. DEFAULT D03: the involved participant sees their own pending edge in the expansion, nobody else;
//   5. people.students of demo-hub-a in pages of 20: every public student once, the totals add up.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv } from '../auth/test-support';
import type { Principal } from '../auth/principal';
import { closeDb, getDb, getPublicDb } from '../db';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { type LineageGraphDto, lineageGraphSchema } from '../dto/public';
import { stopProducer } from '../jobs/boss';
import { egoInput, lineageEgo, personStudents, studentsInput } from './lineage';
import { egoGraph, egoNodeIds, NO_EXTRAS, readTransaction } from './lineage-graph';
import { cachedEgo } from './lineage-public';

// 'use cache' is a plain string outside Next.js; the cache functions are no-ops here.
vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
const ids: Record<string, string> = {};
let pendingUserId: string;

const SLUGS = ['demo-hub-a', 'demo-two-lineages', 'demo-a-001', 'demo-b-001', 'demo-pending', 'demo-root-a', 'demo-converging'];

/** The read of an expansion, as the explorer sends it (expand.ts expandInput), with the API's defaults. */
const expansion = (focusId: string, direction: 'students' | 'teachers') =>
  egoInput.parse({ focusId, up: direction === 'teachers' ? 1 : 0, down: direction === 'students' ? 1 : 0 });

/** The summary node's list: pages of 20 by name (students-list.tsx STUDENTS_PER_PAGE). */
const PAGE_SIZE = 20;

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth;
  const rows = await getDb().execute<{ slug: string; id: string; claimed_by_user_id: string | null }>(
    sql`SELECT slug, id::text AS id, claimed_by_user_id::text AS claimed_by_user_id FROM person WHERE slug = ANY(${`{${SLUGS.join(',')}}`}::text[])`,
  );
  for (const r of rows.rows) ids[r.slug] = r.id;
  expect(Object.keys(ids).sort()).toEqual([...SLUGS].sort());
  pendingUserId = rows.rows.find((r) => r.slug === 'demo-pending')!.claimed_by_user_id!;
});

afterAll(async () => {
  await stopProducer();
  await closeDb();
  await testDb?.drop();
});

function principalOf(userId: string): Principal {
  return {
    user: { id: userId, email: 'demo@example.test', emailVerified: true, role: 'user', twoFactorEnabled: false },
    session: { id: 'test-session', expiresAt: new Date(Date.now() + 3_600_000), twoFactorVerifiedAt: null },
    via: 'bearer',
  };
}

/** The public students of a teacher, by an independent query, in the order of the students' list (ICU, then id). */
async function publicStudents(teacherId: string): Promise<string[]> {
  const r = await getDb().execute<{ id: string }>(sql`
    SELECT s.id::text AS id
      FROM (SELECT DISTINCT pe.student_person_id AS id FROM v_public_edge pe WHERE pe.teacher_person_id = ${teacherId}::uuid) s
      JOIN v_public_person vp ON vp.id = s.id
     ORDER BY vp.display_name COLLATE "und-x-icu", s.id`);
  return r.rows.map((x) => x.id);
}

const publicStudentsShown = (g: LineageGraphDto, teacherId: string) =>
  new Set(g.edges.filter((e) => e.teacherId === teacherId && e.visibility === 'public').map((e) => e.studentId));

describe('the expansion reads (lineage.ego, M06 plan section c)', () => {
  it('1. "+N students" of demo-hub-a: the hub and its first 50 students, their edges only, the rest counted', async () => {
    const hub = ids['demo-hub-a']!;
    const input = expansion(hub, 'students');
    expect(input).toEqual({ focusId: hub, up: 0, down: 1, fanoutLimit: 50 });
    const g = await lineageEgo(null, input);
    // The answer is a public graph and nothing more.
    expect(() => lineageGraphSchema.strict().parse(g)).not.toThrow();
    expect(g.edges.some((e) => e.visibility !== 'public')).toBe(false);
    expect(g.nodes.some((n) => n.visibility !== 'public')).toBe(false);

    // The hub, then its first 50 students in egoNodeIds order (by name, then id; the rest left out).
    const order = await readTransaction(getPublicDb(), (tx) => egoNodeIds(tx, input, NO_EXTRAS));
    expect(g.nodes.map((n) => n.id).sort()).toEqual([...order].sort());
    expect(order[0]).toBe(hub);
    const all = await publicStudents(hub);
    expect(all.length).toBeGreaterThan(50);
    expect(new Set(order.slice(1))).toEqual(new Set(all.slice(0, 50)));

    // Edges only between the people of the answer, and the hub's edge to each of its 50.
    const people = new Set(order);
    for (const e of g.edges) expect(people.has(e.teacherId) && people.has(e.studentId)).toBe(true);
    const shown = publicStudentsShown(g, hub);
    expect(shown).toEqual(new Set(all.slice(0, 50)));

    // What the explorer's "+N students" and "and N more" count: childCount minus those shown.
    const node = g.nodes.find((n) => n.id === hub)!;
    expect(node.childCount).toBe(all.length);
    expect(g.hiddenCounts[hub]!.students).toBe(node.childCount - shown.size);
    expect(node.hasMoreChildren).toBe(true);
  });

  it('2. "+N teachers" of demo-two-lineages: both teachers, the second cross-lineage, none left out', async () => {
    const person = ids['demo-two-lineages']!;
    const g = await lineageEgo(null, expansion(person, 'teachers'));
    const teachers = g.edges.filter((e) => e.studentId === person);
    expect(new Set(teachers.map((e) => e.teacherId))).toEqual(new Set([ids['demo-a-001'], ids['demo-b-001']]));
    expect(teachers.map((e) => e.kind).sort()).toEqual(['crossLineage', 'primary']);
    expect(g.hiddenCounts[person]?.teachers ?? 0).toBe(0);
    // Nobody below: an up=1 expansion reads no students.
    expect(g.edges.every((e) => e.studentId === person)).toBe(true);
  });

  it('3. the cached read and an uncached one give the same answer for an anonymous visitor on the expansion inputs', async () => {
    const inputs = [
      expansion(ids['demo-hub-a']!, 'students'),
      expansion(ids['demo-hub-a']!, 'teachers'),
      expansion(ids['demo-two-lineages']!, 'teachers'),
      expansion(ids['demo-root-a']!, 'students'),
      expansion(ids['demo-converging']!, 'teachers'),
    ];
    for (const input of inputs) {
      const uncached = lineageGraphSchema.parse(await readTransaction(getPublicDb(), (tx) => egoGraph(tx, input, NO_EXTRAS)));
      expect(await cachedEgo(input), JSON.stringify(input)).toEqual(uncached);
      expect(await lineageEgo(null, input), JSON.stringify(input)).toEqual(uncached);
    }
  });

  it('4. DEFAULT D03: the involved participant sees their own pending edge in the expansion of their teacher; an anonymous visitor does not', async () => {
    const hub = ids['demo-hub-a']!;
    const mine = await lineageEgo(principalOf(pendingUserId), expansion(hub, 'students'));
    const anonymous = await lineageEgo(null, expansion(hub, 'students'));
    const own = mine.edges.find((e) => e.teacherId === hub && e.studentId === ids['demo-pending']);
    expect(own).toMatchObject({ status: 'pending_teacher', visibility: 'involved_only' });
    expect(anonymous.edges.some((e) => e.studentId === ids['demo-pending'])).toBe(false);
    expect(anonymous.nodes.some((n) => n.id === ids['demo-pending'])).toBe(false);
    // The pending request is in no count: the hub's numbers are the public ones for both.
    const hubOf = (g: LineageGraphDto) => g.nodes.find((n) => n.id === hub)!;
    expect(hubOf(mine).childCount).toBe(hubOf(anonymous).childCount);
    expect(mine.hiddenCounts[hub]!.students).toBe(hubOf(mine).childCount - publicStudentsShown(mine, hub).size);
    // The participant's own teacher expansion reaches the hub through the same edge.
    const up = await lineageEgo(principalOf(pendingUserId), expansion(ids['demo-pending']!, 'teachers'));
    expect(up.edges.find((e) => e.teacherId === hub && e.studentId === ids['demo-pending'])).toMatchObject({ visibility: 'involved_only' });
  });
});

describe('the summary node\'s list (people.students, M06 plan section c)', () => {
  it('5. demo-hub-a in pages of 20: every public student exactly once, and activeTotal + historicalTotal is childCount', async () => {
    const hub = ids['demo-hub-a']!;
    const all = await publicStudents(hub);
    const first = await personStudents(null, studentsInput.parse({ slug: 'demo-hub-a', page: 1, pageSize: PAGE_SIZE }));
    const ego = await lineageEgo(null, expansion(hub, 'students'));
    const childCount = ego.nodes.find((n) => n.id === hub)!.childCount;
    expect(first.activeTotal + first.historicalTotal).toBe(childCount);
    expect(first.activeTotal + first.historicalTotal).toBe(all.length);
    expect(first.pageCount).toBe(Math.ceil(all.length / PAGE_SIZE));

    const seen: string[] = [];
    for (let page = 1; page <= first.pageCount; page += 1) {
      const answer = await personStudents(null, studentsInput.parse({ slug: 'demo-hub-a', page, pageSize: PAGE_SIZE }));
      expect(answer.page).toBe(page);
      expect(answer.own).toEqual([]);
      const rows = [...answer.active, ...answer.historical].map((s) => s.person.id);
      expect(rows.length, `page ${page}`).toBe(page < first.pageCount ? PAGE_SIZE : all.length - PAGE_SIZE * (first.pageCount - 1));
      seen.push(...rows);
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(new Set(all));
  });
});
