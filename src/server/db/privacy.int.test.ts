// Privacy enforced by the database (milestone M01, Done when 2; plan §6.2, §6.4): the public
// role sees only the three views, the audit log is append-only, and the views show only what is
// public. Runs against the seeded demo data, connecting with the real role passwords.

import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateFixtures } from '../../fixtures/generate';
import { withClient } from './admin';
import { createRoleDatabase, type Database } from './index';
import { rolePassword } from './env';
import { vPublicEdge, vPublicPerson, vPublicSchool } from './schema';
import { PG, pgError, rows, value } from './test-support';
import { createTestDatabase, type TestDatabase } from './testing';

let db: TestDatabase;
let publicDb: Database;
const fixtures = generateFixtures();
const anchor = fixtures.anchors;

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  publicDb = createRoleDatabase('app_public_ro', db.url, rolePassword('app_public_ro'));
});

afterAll(async () => {
  await publicDb?.$client.end();
  await db?.drop();
});

const asRole = <T>(role: 'app_rw' | 'app_public_ro', fn: Parameters<typeof withClient<T>>[1]) => withClient(db.roleUrl(role), fn);

describe('app_public_ro', () => {
  it('logs in with its password and gets permission denied on private tables', async () => {
    await asRole('app_public_ro', async (c) => {
      expect(await value<string>(c, 'SELECT current_user')).toBe('app_public_ro');
      for (const table of ['school_private_location', 'evidence_file', 'evidence_link', 'person', 'teaching_relationship', 'audit_log', 'school']) {
        const error = await pgError(c.query(`SELECT * FROM ${table} LIMIT 1`));
        expect(error.code, table).toBe(PG.insufficientPrivilege);
        expect(error.message).toContain(`permission denied for table ${table}`);
      }
    });
  });

  it('cannot write anything, not even to the views', async () => {
    await asRole('app_public_ro', async (c) => {
      expect((await pgError(c.query("INSERT INTO person (slug, kind) VALUES ('demo-x', 'living')"))).code).toBe(PG.insufficientPrivilege);
      // The views are not updatable at all (joins); either way the write fails.
      expect((await pgError(c.query("UPDATE v_public_person SET slug = 'demo-x'"))).message).toMatch(/permission denied|cannot update view/);
      expect((await pgError(c.query('CREATE TABLE demo_x (id int)'))).code).toBe(PG.insufficientPrivilege);
    });
  });

  it('reads the three public views through Drizzle with a 2 s statement timeout', async () => {
    const people = await publicDb.select().from(vPublicPerson).orderBy(asc(vPublicPerson.slug));
    expect(people.length).toBeGreaterThan(500);
    const timeout = await publicDb.$client.query<{ statement_timeout: string }>('SHOW statement_timeout');
    expect(timeout.rows[0]!.statement_timeout).toBe('2s');
    expect((await publicDb.select().from(vPublicEdge).limit(1)).length).toBe(1);
    expect((await publicDb.select().from(vPublicSchool).limit(1)).length).toBe(1);
  });
});

describe('audit_log', () => {
  const insert = (c: Parameters<Parameters<typeof withClient>[1]>[0]) =>
    c.query(
      `INSERT INTO audit_log (action, subject_type, subject_id, ip_hmac) VALUES ('relationship.verify', 'teaching_relationship', 'demo', $1) RETURNING id`,
      ['a'.repeat(64)],
    );

  it('accepts INSERT from app_rw and refuses UPDATE and DELETE', async () => {
    await asRole('app_rw', async (c) => {
      const { rows: inserted } = await insert(c);
      expect(inserted).toHaveLength(1);
      for (const sql of ["UPDATE audit_log SET reason = 'changed'", 'DELETE FROM audit_log', 'TRUNCATE audit_log']) {
        const error = await pgError(c.query(sql));
        expect(error.code, sql).toBe(PG.insufficientPrivilege);
        expect(error.message).toContain('permission denied for table audit_log');
      }
    });
  });

  it('refuses UPDATE, DELETE and TRUNCATE even for the owner (trigger)', async () => {
    await withClient(db.url, async (c) => {
      await c.query('SET ROLE migrator');
      await insert(c);
      for (const [sql, op] of [
        ["UPDATE audit_log SET reason = 'changed'", 'UPDATE'],
        ['DELETE FROM audit_log', 'DELETE'],
        ['TRUNCATE audit_log', 'TRUNCATE'],
      ] as const) {
        const error = await pgError(c.query(sql));
        expect(error.message, sql).toBe(`audit_log is append-only: ${op} is not allowed`);
      }
      expect(Number(await value<string>(c, 'SELECT count(*) FROM audit_log'))).toBeGreaterThanOrEqual(2);
    });
  });

  it('accepts only a 64-character hex ip_hmac', async () => {
    await asRole('app_rw', async (c) => {
      const error = await pgError(c.query("INSERT INTO audit_log (action, ip_hmac) VALUES ('auth.login', '192.0.2.1')"));
      expect(error.code).toBe(PG.checkViolation);
    });
  });

  it('keeps relationship_event append-only for app_rw, also through a deleted relationship', async () => {
    await asRole('app_rw', async (c) => {
      expect((await pgError(c.query("UPDATE relationship_event SET reason = 'x'"))).code).toBe(PG.insufficientPrivilege);
      expect((await pgError(c.query('DELETE FROM relationship_event'))).code).toBe(PG.insufficientPrivilege);
      // No cascade: a relationship with history cannot be deleted at all (it ends instead).
      const error = await pgError(c.query('DELETE FROM teaching_relationship WHERE id = $1', [fixtures.relationships[0]!.id]));
      expect(error.code).toBe(PG.foreignKeyViolation);
    });
  });
});

describe('public views', () => {
  it('v_public_edge has only verified and in_arbitration relationships with visibility public', async () => {
    await asRole('app_public_ro', async (c) => {
      const statuses = await rows<{ status: string; visibility: string; n: number }>(
        c,
        'SELECT status, visibility, count(*)::int AS n FROM v_public_edge GROUP BY 1, 2 ORDER BY 1',
      );
      expect(statuses.map((s) => s.status)).toEqual(['in_arbitration', 'verified']);
      expect(statuses.every((s) => s.visibility === 'public')).toBe(true);
    });
    // Cross-check with the base table: every public verified/disputed edge between public people.
    await withClient(db.url, async (c) => {
      const expected = await value<number>(
        c,
        `SELECT count(*)::int FROM teaching_relationship r
           JOIN person t ON t.id = r.teacher_person_id AND t.visibility = 'public'
           JOIN person s ON s.id = r.student_person_id AND s.visibility = 'public'
          WHERE r.status IN ('verified', 'in_arbitration') AND r.visibility = 'public'`,
      );
      expect(await value<number>(c, 'SELECT count(*)::int FROM v_public_edge')).toBe(expected);
      const hidden = await value<number>(c, "SELECT count(*)::int FROM teaching_relationship WHERE status NOT IN ('verified', 'in_arbitration')");
      expect(hidden).toBeGreaterThan(0);
    });
  });

  it('demo-pending is not visible: neither its request nor the person', async () => {
    const edges = await publicDb
      .select()
      .from(vPublicEdge)
      .where(inArray(vPublicEdge.studentPersonId, [anchor['demo-pending'], anchor['demo-under-review']]));
    expect(edges).toEqual([]);
    const people = await publicDb.select().from(vPublicPerson).where(eq(vPublicPerson.slug, 'demo-pending'));
    expect(people).toEqual([]);
  });

  it('v_public_person does not contain demo-claim-only-teacher', async () => {
    const people = await publicDb.select().from(vPublicPerson).where(eq(vPublicPerson.id, anchor['demo-claim-only-teacher']));
    expect(people).toEqual([]);
    const disputed = await publicDb.select().from(vPublicPerson).where(eq(vPublicPerson.slug, 'demo-arbitration'));
    expect(disputed).toHaveLength(1);
  });

  it('v_public_person carries the display name, the other names and the biography', async () => {
    const [cjk] = await publicDb.select().from(vPublicPerson).where(eq(vPublicPerson.slug, 'demo-cjk-name'));
    expect(cjk!.displayName).toBe('So Ching Laam');
    expect(cjk!.altNames.map((n) => n.value)).toEqual(expect.arrayContaining(['蘇晴嵐', 'sou1 cing4 laam4', 'Sū Qínglán']));
    expect(cjk!.bio).toContain('Fictional demo record');
  });

  it('v_public_school shows the city centroid, never the exact point, for city_only schools', async () => {
    const [cityOnly] = await publicDb.select().from(vPublicSchool).where(eq(vPublicSchool.slug, 'demo-school-city-only'));
    expect(cityOnly!.precision).toBe('city');
    expect(cityOnly!.publicPoint).toEqual({ lng: 24.75, lat: 42.15 });
    const exact = fixtures.schoolPrivateLocations.find((l) => l.schoolId === cityOnly!.id)!.exactPoint;
    expect(cityOnly!.publicPoint).not.toEqual(exact);
    const [two] = await publicDb.select().from(vPublicSchool).where(eq(vPublicSchool.slug, 'demo-school-two-lineages'));
    expect(two!.instructorPersonIds).toContain(anchor['demo-two-lineages']);
    // Drafts are not public.
    expect(await publicDb.select().from(vPublicSchool).where(eq(vPublicSchool.slug, 'demo-school-hamburg-draft'))).toEqual([]);
  });

  it('school.public_point is of type geography', async () => {
    await withClient(db.url, async (c) => {
      expect(await value<string>(c, 'SELECT DISTINCT pg_typeof(public_point)::text FROM school')).toBe('geography');
    });
  });
});
