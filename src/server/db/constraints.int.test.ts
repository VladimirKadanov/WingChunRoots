// Constraints and identifiers (milestone M01, Done when 2): a relationship of a person with
// themselves and a duplicate active relationship are refused; new ids are UUID version 7.

import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { uuidVersion } from './ids';
import { lineage, person, personName, school, schoolPrivateLocation, place, teachingRelationship } from './schema';
import { PG, pgError } from './test-support';
import { createTestDatabase, type TestDatabase } from './testing';

let db: TestDatabase;
let client: Client;
let orm: NodePgDatabase;
let teacherId: string;
let studentId: string;
let lineageId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  // The application role: the constraints hold for app_rw, not only for the owner.
  client = new Client({ connectionString: db.roleUrl('app_rw') });
  await client.connect();
  orm = drizzle({ client });
  const [teacher, student] = await orm
    .insert(person)
    .values([
      { slug: 'demo-it-teacher', kind: 'living' },
      { slug: 'demo-it-student', kind: 'living' },
    ])
    .returning({ id: person.id });
  teacherId = teacher!.id;
  studentId = student!.id;
  const [l] = await orm.insert(lineage).values({ slug: 'demo-it-lineage', name: 'Demo IT Lineage' }).returning({ id: lineage.id });
  lineageId = l!.id;
});

afterAll(async () => {
  await client?.end();
  await db?.drop();
});

const relationship = (overrides: Partial<typeof teachingRelationship.$inferInsert> = {}) =>
  orm
    .insert(teachingRelationship)
    .values({ teacherPersonId: teacherId, studentPersonId: studentId, lineageId, status: 'pending_teacher', ...overrides })
    .returning();

describe('teaching_relationship constraints', () => {
  it('refuses a relationship of a person with themselves', async () => {
    const error = await pgError(relationship({ studentPersonId: teacherId }));
    expect(error.code).toBe(PG.checkViolation);
    expect(error.constraint).toBe('teaching_relationship_not_self');
  });

  it('refuses a second active relationship for the same teacher, student and lineage', async () => {
    const [first] = await relationship();
    expect(first!.status).toBe('pending_teacher');
    const error = await pgError(relationship({ status: 'under_review' }));
    expect(error.code).toBe(PG.uniqueViolation);
    expect(error.constraint).toBe('teaching_relationship_active_key');

    // Once the first one is no longer active (rejected), a new request is allowed.
    await orm.update(teachingRelationship).set({ status: 'rejected' }).where(eq(teachingRelationship.id, first!.id));
    const [second] = await relationship();
    expect(second!.id).not.toBe(first!.id);
    await orm.update(teachingRelationship).set({ status: 'withdrawn' }).where(eq(teachingRelationship.id, second!.id));
  });

  it('refuses an unknown status and a public relationship that is not verified (D03)', async () => {
    expect((await pgError(client.query(
      `INSERT INTO teaching_relationship (teacher_person_id, student_person_id, lineage_id, status) VALUES ($1, $2, $3, 'approved')`,
      [teacherId, studentId, lineageId],
    ))).code).toBe(PG.checkViolation);
    expect((await pgError(relationship({ visibility: 'public' }))).code).toBe(PG.checkViolation);
  });

  it('allows one display-primary teacher per student, only on established relationships (DEFAULT D05)', async () => {
    const [other, third] = await orm
      .insert(person)
      .values([
        { slug: 'demo-it-second-teacher', kind: 'living' },
        { slug: 'demo-it-third-teacher', kind: 'living' },
      ])
      .returning({ id: person.id });
    const [primary] = await relationship({ status: 'verified', visibility: 'public', isDisplayPrimary: true });
    const error = await pgError(relationship({ teacherPersonId: other!.id, status: 'verified', visibility: 'public', isDisplayPrimary: true }));
    expect(error.code).toBe(PG.uniqueViolation);
    expect(error.constraint).toBe('teaching_relationship_one_display_primary_key');
    const [second] = await relationship({ teacherPersonId: other!.id, status: 'verified', visibility: 'public', isDisplayPrimary: false });
    expect(primary!.isDisplayPrimary).toBe(true);

    // A request never carries the flag (the verify transition sets it, M09), so a private request
    // cannot take a public student's slot and hint at itself (plan §4.14, D03).
    for (const status of ['pending_teacher', 'awaiting_claim', 'under_review'] as const) {
      const request = await pgError(relationship({ teacherPersonId: third!.id, status, isDisplayPrimary: true }));
      expect(request.code, status).toBe(PG.checkViolation);
      expect(request.constraint, status).toBe('teaching_relationship_display_primary_after_verification');
    }
    const [pending] = await relationship({ teacherPersonId: third!.id, status: 'pending_teacher' });
    expect(pending!.isDisplayPrimary).toBe(false);

    // A revoked relationship keeps its flag as history and frees the slot for another teacher.
    await orm.update(teachingRelationship).set({ status: 'revoked' }).where(eq(teachingRelationship.id, primary!.id));
    await orm.update(teachingRelationship).set({ isDisplayPrimary: true }).where(eq(teachingRelationship.id, second!.id));
    const flagged = await orm
      .select({ id: teachingRelationship.id, status: teachingRelationship.status })
      .from(teachingRelationship)
      .where(eq(teachingRelationship.isDisplayPrimary, true));
    expect(flagged.map((r) => r.status).sort()).toEqual(['revoked', 'verified']);
  });
});

describe('other constraints', () => {
  it('refuses a slug that does not follow the format and a second primary name', async () => {
    expect((await pgError(orm.insert(person).values({ slug: 'Demo Upper', kind: 'living' }))).code).toBe(PG.checkViolation);
    await orm.insert(personName).values({ personId: studentId, kind: 'name', value: 'Ivan Testov', script: 'Latn', lang: 'bg-Latn', isPrimary: true });
    const error = await pgError(
      orm.insert(personName).values({ personId: studentId, kind: 'name', value: 'Ivo Testov', script: 'Latn', lang: 'bg-Latn', isPrimary: true }),
    );
    expect(error.code).toBe(PG.uniqueViolation);
    // A primary name must be in Latin script (plan §5.3).
    const [other] = await orm.insert(person).values({ slug: 'demo-it-cjk', kind: 'living' }).returning({ id: person.id });
    const cjk = await pgError(
      orm.insert(personName).values({ personId: other!.id, kind: 'name', value: '蘇晴嵐', script: 'Hant', lang: 'zh-Hant', isPrimary: true }),
    );
    expect(cjk.code).toBe(PG.checkViolation);
  });
});

describe('identifiers', () => {
  it('are UUIDv7 when the application inserts through Drizzle', async () => {
    const [p] = await orm.insert(person).values({ slug: 'demo-it-uuid', kind: 'living' }).returning({ id: person.id });
    expect(uuidVersion(p!.id)).toBe(7);
    const fromDb = await client.query<{ v: number }>(
      "SELECT get_byte(uuid_send(id), 6) >> 4 AS v FROM person WHERE slug = 'demo-it-uuid'",
    );
    expect(fromDb.rows[0]!.v).toBe(7);
  });

  it('fall back to gen_random_uuid() for a manual SQL insert', async () => {
    const { rows } = await client.query<{ id: string }>("INSERT INTO person (slug, kind) VALUES ('demo-it-sql', 'living') RETURNING id");
    expect(uuidVersion(rows[0]!.id)).toBe(4);
  });
});

describe('geography', () => {
  it('round-trips a point through the customType, longitude first', async () => {
    const [pl] = await orm
      .insert(place)
      .values({ geonamesId: 728193, name: 'Plovdiv', asciiName: 'Plovdiv', countryCode: 'BG', centroid: { lng: 24.75, lat: 42.15 } })
      .returning();
    expect(pl!.centroid).toEqual({ lng: 24.75, lat: 42.15 });
    const [s] = await orm
      .insert(school)
      .values({ slug: 'demo-it-school', name: 'Demo IT School', placeId: pl!.id, locationPrivacy: 'city_only', publicPoint: pl!.centroid })
      .returning();
    await orm.insert(schoolPrivateLocation).values({ schoolId: s!.id, exactPoint: { lng: 24.7512, lat: 42.1433 } });
    const { rows } = await client.query<{ type: string; km: number }>(
      `SELECT pg_typeof(s.public_point)::text AS type,
              round((ST_Distance(s.public_point, l.exact_point) / 1000)::numeric, 1)::float AS km
         FROM school s JOIN school_private_location l ON l.school_id = s.id WHERE s.slug = 'demo-it-school'`,
    );
    expect(rows[0]!.type).toBe('geography');
    // geography measures in metres: about 0.8 km, not a fraction of a degree.
    expect(rows[0]!.km).toBeGreaterThan(0.5);
    expect(rows[0]!.km).toBeLessThan(1.5);
  });
});
