// Privacy enforced by the database (milestone M01, Done when 2; plan §6.2, §6.4): the public
// role sees only the three views, the audit log is append-only, and the views show only what is
// public. Runs against the seeded demo data, connecting with the real role passwords.

import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

  it('can read exactly the three public views and the PostGIS catalogue, and write nothing', async () => {
    // Every relation of every non-system schema, so a later GRANT on a private table (invitation,
    // person_claim, ...) fails here whatever the migration's wording.
    const relations = (privilege: string) =>
      withClient(db.url, async (c) =>
        (
          await rows<{ name: string }>(
            c,
            `SELECT n.nspname || '.' || c.relname AS name
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_(toast|temp)'
                AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
                AND has_table_privilege('app_public_ro', c.oid, $1)
              ORDER BY 1`,
            [privilege],
          )
        ).map((r) => r.name),
      );
    expect(await relations('SELECT')).toEqual([
      // PostGIS grants SELECT on its catalogue to PUBLIC.
      'public.geography_columns',
      'public.geometry_columns',
      'public.spatial_ref_sys',
      'public.v_public_edge',
      'public.v_public_person',
      'public.v_public_school',
    ]);
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      expect(await relations(privilege), privilege).toEqual([]);
    }
  });

  it('cannot create temporary tables; app_rw can', async () => {
    await withClient(db.url, async (c) => {
      expect(await value<boolean>(c, "SELECT has_database_privilege('app_public_ro', current_database(), 'TEMP')")).toBe(false);
      expect(await value<boolean>(c, "SELECT has_database_privilege('app_rw', current_database(), 'TEMP')")).toBe(true);
    });
    await asRole('app_public_ro', async (c) => {
      const error = await pgError(c.query('CREATE TEMP TABLE demo_staging (id int)'));
      expect(error.code).toBe(PG.insufficientPrivilege);
      expect(error.message).toContain('permission denied to create temporary tables');
    });
    await asRole('app_rw', async (c) => {
      await c.query('CREATE TEMP TABLE demo_staging (id int)');
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

describe('role pools', () => {
  it('survive a pooled client that the server terminates while idle, and reconnect', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rows: before } = await publicDb.$client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      // The client is idle in the pool now; the server ends it (as a restart or sleep would).
      await withClient(db.url, (c) => c.query('SELECT pg_terminate_backend($1)', [before[0]!.pid]));
      await vi.waitFor(() => expect(log).toHaveBeenCalledWith('db pool app_public_ro: idle client error 57P01'));
      const { rows: after } = await publicDb.$client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      expect(after[0]!.pid).not.toBe(before[0]!.pid);
    } finally {
      log.mockRestore();
    }
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
      // PostgreSQL 18 reports ON DELETE RESTRICT as restrict_violation, 16 as foreign_key_violation.
      expect([PG.restrictViolation, PG.foreignKeyViolation]).toContain(error.code);
      expect(error.message).toContain('on table "relationship_event"');
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

  it('every v_public_edge endpoint is a v_public_person, even for a person without a primary name', async () => {
    const orphans = 'SELECT count(*)::int FROM v_public_edge e WHERE NOT EXISTS (SELECT 1 FROM v_public_person p WHERE p.id = e.teacher_person_id) OR NOT EXISTS (SELECT 1 FROM v_public_person p WHERE p.id = e.student_person_id)';
    await asRole('app_public_ro', async (c) => {
      expect(await value<number>(c, 'SELECT count(*)::int FROM v_public_edge')).toBeGreaterThan(500);
      expect(await value<number>(c, orphans)).toBe(0);
    });
    // A public person who lost the primary name (a bug or a manual fix) leaves both views.
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      try {
        const person = anchor['demo-hub-a']!;
        expect(await value<number>(c, 'SELECT count(*)::int FROM v_public_edge WHERE teacher_person_id = $1', [person])).toBeGreaterThan(100);
        await c.query('UPDATE person_name SET is_primary = false WHERE person_id = $1', [person]);
        expect(await value<number>(c, 'SELECT count(*)::int FROM v_public_person WHERE id = $1', [person])).toBe(0);
        expect(await value<number>(c, 'SELECT count(*)::int FROM v_public_edge WHERE $1 IN (teacher_person_id, student_person_id)', [person])).toBe(0);
        expect(await value<number>(c, orphans)).toBe(0);
      } finally {
        await c.query('ROLLBACK');
      }
    });
  });

  it('school.public_point is the city centroid for every city_only school, whoever writes it (plan §6.4)', async () => {
    await asRole('app_rw', async (c) => {
      await c.query('BEGIN');
      try {
        const point = `SELECT ST_X(s.public_point::geometry) AS lng, ST_Y(s.public_point::geometry) AS lat,
                              ST_Equals(s.public_point::geometry, p.centroid::geometry) AS at_centroid,
                              ST_Equals(s.public_point::geometry, l.exact_point::geometry) AS at_exact
                         FROM school s JOIN place p ON p.id = s.place_id JOIN school_private_location l ON l.school_id = s.id
                        WHERE s.slug = $1`;
        type Point = { lng: number; lat: number; at_centroid: boolean; at_exact: boolean };
        // demo-school-sofia shows its exact point until it switches to city_only.
        expect((await rows<Point>(c, point, ['demo-school-sofia']))[0]).toMatchObject({ at_exact: true, at_centroid: false });
        await c.query("UPDATE school SET location_privacy = 'city_only' WHERE slug = 'demo-school-sofia'");
        expect((await rows<Point>(c, point, ['demo-school-sofia']))[0]).toMatchObject({ at_exact: false, at_centroid: true });
        // Writing the exact point into public_point does not stick either.
        await c.query(
          `UPDATE school s SET public_point = l.exact_point FROM school_private_location l
            WHERE l.school_id = s.id AND s.slug = 'demo-school-sofia'`,
        );
        expect((await rows<Point>(c, point, ['demo-school-sofia']))[0]).toMatchObject({ at_exact: false, at_centroid: true });
        // A corrected city centroid moves every city_only school of that city with it.
        await c.query(
          `UPDATE place SET centroid = 'SRID=4326;POINT(23.33 42.7)'::geography
            WHERE id = (SELECT place_id FROM school WHERE slug = 'demo-school-sofia')`,
        );
        expect((await rows<Point>(c, point, ['demo-school-sofia']))[0]).toMatchObject({ lng: 23.33, lat: 42.7, at_centroid: true });
        // Back to exact: the application writes the exact point again, and it is kept.
        await c.query(
          `UPDATE school s SET location_privacy = 'exact', public_point = l.exact_point FROM school_private_location l
            WHERE l.school_id = s.id AND s.slug = 'demo-school-sofia'`,
        );
        expect((await rows<Point>(c, point, ['demo-school-sofia']))[0]).toMatchObject({ at_exact: true });
        // A new city_only school gets the centroid whatever point the insert carries.
        const { rows: inserted } = await c.query<{ at_centroid: boolean }>(
          `INSERT INTO school (slug, name, place_id, location_privacy, public_point)
           SELECT 'demo-it-city-only', 'Demo IT City Only', s.place_id, 'city_only', l.exact_point
             FROM school s JOIN school_private_location l ON l.school_id = s.id WHERE s.slug = 'demo-school-sofia'
           RETURNING ST_Equals(public_point::geometry, (SELECT centroid::geometry FROM place WHERE id = place_id)) AS at_centroid`,
        );
        expect(inserted[0]!.at_centroid).toBe(true);
      } finally {
        await c.query('ROLLBACK');
      }
    });
    // The seeded city_only schools already hold the centroid.
    await withClient(db.url, async (c) => {
      const wrong = await value<number>(
        c,
        `SELECT count(*)::int FROM school s JOIN place p ON p.id = s.place_id
          WHERE s.location_privacy = 'city_only' AND NOT ST_Equals(s.public_point::geometry, p.centroid::geometry)`,
      );
      expect(wrong).toBe(0);
      expect(await value<number>(c, "SELECT count(*)::int FROM school WHERE location_privacy = 'city_only'")).toBeGreaterThan(0);
    });
  });

  it('the radius query of plan §6.3 on school.public_point uses the GiST index', async () => {
    // M11 runs it as app_rw on school (with lineage_membership and school_instructor), which the
    // city_only trigger makes safe. Through the security_barrier view v_public_school the index
    // cannot be used: ST_DWithin is not leakproof, so it stays above the view's own filters.
    await asRole('app_rw', async (c) => {
      await c.query('BEGIN');
      try {
        // Few rows: without this the planner would rather scan.
        await c.query('SET LOCAL enable_seqscan = off');
        const plan = (
          await rows<{ 'QUERY PLAN': string }>(
            c,
            `EXPLAIN SELECT id FROM school
              WHERE ST_DWithin(public_point, 'SRID=4326;POINT(23.32 42.69)'::geography, 50000)`,
          )
        )
          .map((r) => r['QUERY PLAN'])
          .join('\n');
        expect(plan).toContain('school_public_point_gist_idx');
      } finally {
        await c.query('ROLLBACK');
      }
    });
  });

  it('school.public_point is of type geography', async () => {
    await withClient(db.url, async (c) => {
      expect(await value<string>(c, 'SELECT DISTINCT pg_typeof(public_point)::text FROM school')).toBe('geography');
    });
  });
});
