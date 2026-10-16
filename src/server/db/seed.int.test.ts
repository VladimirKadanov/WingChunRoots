// The demo data in the database (milestone M01, Done when 2): two consecutive loads give the
// same content hash, and the statistics measured in SQL are in the ranges of In scope 10.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateFixtures, STAT_RANGES, TARGET_PERSONS } from '../../fixtures/generate';
import { withClient } from './admin';
import { RELATIONSHIP_STATUSES } from './schema';
import { seedDatabase, type SeedResult } from './seed';
import { rows, value } from './test-support';
import { createTestDatabase, type TestDatabase } from './testing';

let db: TestDatabase;
let first: SeedResult;
let second: SeedResult;

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  first = db.seeded!;
  second = await seedDatabase(db.url);
});

afterAll(async () => {
  await db?.drop();
});

const one = <T>(text: string) => withClient(db.url, (c) => value<T>(c, text));

describe('db:seed', () => {
  it('gives the same content hash on two consecutive loads', () => {
    expect(second.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.hash).toBe(first.hash);
    expect(second.counts).toEqual(first.counts);
  });

  it('loads every generated row', () => {
    const f = generateFixtures();
    expect(first.counts).toMatchObject({
      person: f.persons.length,
      person_name: f.personNames.length,
      teaching_relationship: f.relationships.length,
      school: f.schools.length,
    });
  });

  it('refuses to run with NODE_ENV=production', async () => {
    const previous = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    try {
      await expect(seedDatabase(db.url)).rejects.toThrow(/production/);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = previous;
    }
  });
});

describe('statistics of the demo data, measured in the database', () => {
  it('550–650 people in 3 lineages; two hubs with at least 120 students', async () => {
    const persons = await one<number>('SELECT count(*)::int FROM person');
    expect(persons).toBe(TARGET_PERSONS);
    expect(persons).toBeGreaterThanOrEqual(STAT_RANGES.persons[0]);
    expect(persons).toBeLessThanOrEqual(STAT_RANGES.persons[1]);
    expect(await one<number>('SELECT count(*)::int FROM lineage')).toBe(3);
    const hubs = await withClient(db.url, (c) =>
      rows<{ slug: string; n: number }>(
        c,
        `SELECT p.slug, count(DISTINCT r.student_person_id)::int AS n
           FROM person p JOIN teaching_relationship r ON r.teacher_person_id = p.id
          WHERE p.slug IN ('demo-hub-a', 'demo-hub-b') AND r.status IN ('verified', 'in_arbitration')
          GROUP BY p.slug ORDER BY p.slug`,
      ),
    );
    expect(hubs.map((h) => h.slug)).toEqual(['demo-hub-a', 'demo-hub-b']);
    for (const h of hubs) expect(h.n, h.slug).toBeGreaterThanOrEqual(STAT_RANGES.hubStudentsMin);
  });

  it('6–10 % with two teachers in one lineage, 2–4 % with a teacher from another lineage, 1–3 % historical only', async () => {
    const stats = await withClient(db.url, (c) =>
      rows<{ total: number; converging: number; cross: number; historical: number }>(
        c,
        `WITH est AS (
           SELECT * FROM teaching_relationship WHERE status IN ('verified', 'in_arbitration')
         ), per_student AS (
           SELECT student_person_id,
                  max(teachers) AS max_teachers_in_one_lineage,
                  count(*) AS lineages
             FROM (SELECT student_person_id, lineage_id, count(DISTINCT teacher_person_id) AS teachers
                     FROM est GROUP BY 1, 2) x
            GROUP BY 1
         ), ongoing AS (
           SELECT DISTINCT e.student_person_id
             FROM est e JOIN training_period tp ON tp.relationship_id = e.id AND tp.ongoing
         )
         SELECT (SELECT count(*) FROM person)::int AS total,
                count(*) FILTER (WHERE max_teachers_in_one_lineage >= 2)::int AS converging,
                count(*) FILTER (WHERE lineages >= 2)::int AS cross,
                count(*) FILTER (WHERE student_person_id NOT IN (SELECT student_person_id FROM ongoing))::int AS historical
           FROM per_student`,
      ),
    );
    const s = stats[0]!;
    const inRange = (n: number, [lo, hi]: readonly [number, number]) => n / s.total >= lo && n / s.total <= hi;
    expect(inRange(s.converging, STAT_RANGES.twoTeachersSameLineage), `converging ${s.converging}`).toBe(true);
    expect(inRange(s.cross, STAT_RANGES.crossLineage), `cross ${s.cross}`).toBe(true);
    expect(inRange(s.historical, STAT_RANGES.historicalOnly), `historical ${s.historical}`).toBe(true);
  });

  it('at least one relationship in every status of plan §6.7', async () => {
    const statuses = await withClient(db.url, (c) => rows<{ status: string }>(c, 'SELECT DISTINCT status FROM teaching_relationship ORDER BY 1'));
    expect(statuses.map((s) => s.status)).toEqual([...RELATIONSHIP_STATUSES].sort());
  });

  it('names in Latin for everyone, Chinese with Jyutping and pinyin for many, Cyrillic for a few', async () => {
    expect(
      await one<number>(
        `SELECT count(*)::int FROM person p WHERE NOT EXISTS (
           SELECT 1 FROM person_name n WHERE n.person_id = p.id AND n.is_primary AND n.script = 'Latn')`,
      ),
    ).toBe(0);
    expect(await one<number>("SELECT count(DISTINCT person_id)::int FROM person_name WHERE script IN ('Hant', 'Hans')")).toBeGreaterThan(100);
    expect(await one<number>("SELECT count(*)::int FROM person_name WHERE romanization = 'jyutping'")).toBeGreaterThan(100);
    expect(await one<number>("SELECT count(*)::int FROM person_name WHERE romanization = 'pinyin'")).toBeGreaterThan(100);
    expect(await one<number>("SELECT count(DISTINCT person_id)::int FROM person_name WHERE script = 'Cyrl'")).toBeGreaterThanOrEqual(3);
    expect(await one<number>("SELECT count(*)::int FROM person_name WHERE kind = 'alias'")).toBeGreaterThan(0);
  });

  it('only fictional records: demo- slugs and the mark in every biography (D20)', async () => {
    for (const table of ['person', 'lineage', 'school', 'organization']) {
      expect(await one<number>(`SELECT count(*)::int FROM ${table} WHERE slug NOT LIKE 'demo-%'`), table).toBe(0);
    }
    expect(await one<number>("SELECT count(*)::int FROM person_bio WHERE body NOT LIKE '%Fictional demo record%'")).toBe(0);
  });

  it('person.visibility is public exactly for people with a public relationship', async () => {
    expect(
      await one<number>(
        `SELECT count(*)::int FROM person p
          WHERE (p.visibility = 'public') <> EXISTS (
            SELECT 1 FROM teaching_relationship r
             WHERE (r.teacher_person_id = p.id OR r.student_person_id = p.id)
               AND r.status IN ('verified', 'in_arbitration') AND r.visibility = 'public')`,
      ),
    ).toBe(0);
  });
});
