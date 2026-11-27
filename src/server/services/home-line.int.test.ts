// lineage.home (journey review 2026-11-26, P1-4; ADR 0078): the home page's line of a real public
// lineage. The chosen lineage wins; without one the rotation takes a different public lineage each
// day; every step is a public link of that lineage, from its root down, at most eight people; the
// read goes through the public views only and carries the tags that drop it.
// Runs against a throwaway database, seeded with the demo data.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestAuthEnv } from '../auth/test-support';
import { closeDb, getDb } from '../db';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import { stopProducer } from '../jobs/boss';
import { HOME_LINE_MAX, homeLine, rotationDay } from './home-line';

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

beforeAll(async () => {
  setTestAuthEnv();
  testDb = await createTestDatabase({ seed: true });
  process.env.DATABASE_URL = testDb.url;
});

afterAll(async () => {
  await stopProducer();
  await closeDb();
  await testDb?.drop();
});

beforeEach(() => {
  cache.tags.length = 0;
});

async function publicEdge(teacherId: string, studentId: string, lineageId: string): Promise<boolean> {
  const r = await getDb().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM v_public_edge
     WHERE teacher_person_id = ${teacherId}::uuid AND student_person_id = ${studentId}::uuid AND lineage_id = ${lineageId}::uuid`);
  return r.rows[0]!.n === 1;
}

describe('lineage.home', () => {
  it('draws the chosen lineage from its public root down, along public links, at most eight people', async () => {
    const line = await homeLine();
    expect(line.lineage?.slug).toBe('demo-lineage-a');
    expect(line.people.length).toBeGreaterThanOrEqual(2);
    expect(line.people.length).toBeLessThanOrEqual(HOME_LINE_MAX);
    expect(line.links).toHaveLength(line.people.length - 1);
    const root = await getDb().execute<{ id: string }>(sql`SELECT root_person_id::text AS id FROM lineage WHERE slug = 'demo-lineage-a'`);
    expect(line.people[0]!.id).toBe(root.rows[0]!.id);
    expect(line.people[0]!.startYear).toBeNull();
    for (let i = 1; i < line.people.length; i += 1) {
      expect(await publicEdge(line.people[i - 1]!.id, line.people[i]!.id, line.lineage!.id), `step ${i}`).toBe(true);
    }
    expect(new Set(line.people.map((p) => p.id)).size).toBe(line.people.length);
    expect(cache.tags).toContain('explore-start');
    expect(cache.tags).toContain(`lineage:${line.lineage!.id}`);
    for (const p of line.people) expect(cache.tags).toContain(`person:${p.id}`);
  });

  it('without a chosen lineage, rotates through the public lineages by the day', async () => {
    await getDb().execute(sql`UPDATE lineage SET featured_on_home = false`);
    try {
      const day = rotationDay(new Date('2026-11-27T12:00:00Z'));
      const seen = new Set<string>();
      for (let d = 0; d < 3; d += 1) seen.add((await homeLine(new Date((day + d) * 86_400_000 + 3_600_000))).lineage!.slug);
      expect(seen.size).toBeGreaterThan(1);
    } finally {
      await getDb().execute(sql`UPDATE lineage SET featured_on_home = true WHERE slug = 'demo-lineage-a'`);
    }
  });

  it('allows one chosen lineage at most', async () => {
    await expect(getDb().execute(sql`UPDATE lineage SET featured_on_home = true WHERE slug = 'demo-lineage-b'`)).rejects.toThrow();
  });
});
