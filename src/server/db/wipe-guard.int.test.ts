// The data check of db:seed and db:reset against real databases (review 2026-11-13, ops.md H2): a
// database with nothing in it, or only the demo data, may be wiped; one row that is not demo data
// (a person slug without demo-, an account outside the reserved .test domain, a school) makes both
// commands refuse and leaves every row in place, until WCR_ALLOW_WIPE=1 says the wipe is intended.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetDatabase, withClient } from './admin';
import { seedDatabase } from './seed';
import { value } from './test-support';
import { createTestDatabase, type TestDatabase } from './testing';
import { ALLOW_WIPE_VARIABLE, findNonDemoData } from './wipe-guard';

let seeded: TestDatabase;
let empty: TestDatabase;
let previousAllow: string | undefined;

beforeAll(async () => {
  // A shell that exports WCR_ALLOW_WIPE=1 must not turn the refusals below into passes.
  previousAllow = process.env[ALLOW_WIPE_VARIABLE];
  delete process.env[ALLOW_WIPE_VARIABLE];
  seeded = await createTestDatabase({ seed: true });
  empty = await createTestDatabase({ migrate: false });
}, 180_000);

afterAll(async () => {
  if (previousAllow === undefined) delete process.env[ALLOW_WIPE_VARIABLE];
  else process.env[ALLOW_WIPE_VARIABLE] = previousAllow;
  await Promise.all([seeded?.drop(), empty?.drop()]);
});

const sql = <T>(db: TestDatabase, text: string, params: unknown[] = []) => withClient(db.url, (c) => value<T>(c, text, params));
const run = (db: TestDatabase, text: string, params: unknown[] = []) => withClient(db.url, (c) => c.query(text, params));
const countOf = async (db: TestDatabase, table: string) => Number(await sql<string>(db, `SELECT count(*) FROM ${table}`));

/** Applies `change`, proves that db:seed and db:reset both refuse with `message` and lose nothing, then undoes it. */
async function refused(change: string, undo: string, message: RegExp): Promise<void> {
  const people = await countOf(seeded, 'person');
  const accounts = await countOf(seeded, 'auth_user');
  await run(seeded, change);
  try {
    await expect(seedDatabase(seeded.url)).rejects.toThrow(message);
    await expect(resetDatabase(seeded.url)).rejects.toThrow(message);
    await expect(seedDatabase(seeded.url)).rejects.toThrow(/WCR_ALLOW_WIPE=1/);
    // Nothing was truncated or dropped.
    expect(await countOf(seeded, 'person')).toBe(people);
    expect(await countOf(seeded, 'auth_user')).toBe(accounts);
  } finally {
    await run(seeded, undo);
  }
}

describe('what counts as demo data', () => {
  it('finds nothing to lose in a database with no tables at all, and in the seeded demo database', async () => {
    const none = await withClient(empty.url, (c) => findNonDemoData(c));
    expect(none).toEqual({ bySlug: { person: 0, school: 0, organization: 0, lineage: 0, event: 0 }, accounts: 0 });
    const demo = await withClient(seeded.url, (c) => findNonDemoData(c));
    expect(demo).toEqual({ bySlug: { person: 0, school: 0, organization: 0, lineage: 0, event: 0 }, accounts: 0 });
  });

  it('counts a person, a school, an organization, a lineage, an event and an account that are not demo data', async () => {
    const changes: [string, string][] = [
      ["UPDATE person SET slug = 'real-teacher' WHERE slug = 'demo-pro-sifu-8'", "UPDATE person SET slug = 'demo-pro-sifu-8' WHERE slug = 'real-teacher'"],
      ["UPDATE school SET slug = 'real-school' WHERE slug = 'demo-school-sofia'", "UPDATE school SET slug = 'demo-school-sofia' WHERE slug = 'real-school'"],
      ["UPDATE organization SET slug = 'real-org' WHERE slug = 'demo-federation-north'", "UPDATE organization SET slug = 'demo-federation-north' WHERE slug = 'real-org'"],
      ['UPDATE lineage SET slug = \'real-lineage\' WHERE id = (SELECT id FROM lineage ORDER BY id LIMIT 1)', ''],
      ["UPDATE event SET slug = 'real-event' WHERE slug = 'demo-federation-summer-camp'", "UPDATE event SET slug = 'demo-federation-summer-camp' WHERE slug = 'real-event'"],
      ["UPDATE auth_user SET email = 'someone@example.com' WHERE email = 'demo-admin@example.test'", "UPDATE auth_user SET email = 'demo-admin@example.test' WHERE email = 'someone@example.com'"],
    ];
    const lineageBefore = await sql<string>(seeded, 'SELECT slug FROM lineage ORDER BY id LIMIT 1');
    changes[3]![1] = `UPDATE lineage SET slug = '${lineageBefore}' WHERE slug = 'real-lineage'`;
    const expected = ['person', 'school', 'organization', 'lineage', 'event'] as const;
    for (const [index, [change, undo]] of changes.entries()) {
      await run(seeded, change);
      try {
        const found = await withClient(seeded.url, (c) => findNonDemoData(c));
        if (index < expected.length) expect(found.bySlug[expected[index]!], expected[index]).toBe(1);
        else expect(found.accounts).toBe(1);
      } finally {
        await run(seeded, undo);
      }
    }
    expect(await withClient(seeded.url, (c) => findNonDemoData(c))).toMatchObject({ accounts: 0 });
  });

  it('treats only the reserved .test top-level domain as demo, not a look-alike', async () => {
    // (auth_user_email_lowercase: addresses are stored in lower case, so the check need not fold case.)
    for (const [email, expectedCount] of [
      ['demo-admin@mail.example.test', 0],
      ['demo-admin@example.test.com', 1],
      ['demo-admin@example.org', 1],
      ['demo-admin@test', 1],
      ['demo-admin-no-at.test', 1],
    ] as const) {
      await run(seeded, "UPDATE auth_user SET email = $1 WHERE email = 'demo-admin@example.test'", [email]);
      try {
        expect((await withClient(seeded.url, (c) => findNonDemoData(c))).accounts, email).toBe(expectedCount);
      } finally {
        await run(seeded, "UPDATE auth_user SET email = 'demo-admin@example.test' WHERE email = $1", [email]);
      }
    }
  });
});

describe('db:seed and db:reset', () => {
  it('load demo data over demo data (twice, as a developer does)', async () => {
    const first = await seedDatabase(seeded.url);
    const second = await seedDatabase(seeded.url);
    expect(second.hash).toBe(first.hash);
  });

  it('refuse a database with one person whose slug is not demo-, and lose nothing', async () => {
    await refused(
      "UPDATE person SET slug = 'real-teacher' WHERE slug = 'demo-pro-sifu-8'",
      "UPDATE person SET slug = 'demo-pro-sifu-8' WHERE slug = 'real-teacher'",
      /db:(seed|reset) refuses postgres:.*it holds data that is not demo data \(1 person whose slug does not start with demo-\)/,
    );
  });

  it('refuse a database with one account outside the reserved .test domain', async () => {
    await refused(
      "UPDATE auth_user SET email = 'someone@example.com' WHERE email = 'demo-admin@example.test'",
      "UPDATE auth_user SET email = 'demo-admin@example.test' WHERE email = 'someone@example.com'",
      /1 account whose address is not in the reserved \.test domain/,
    );
  });

  it('never put an address or a slug into the refusal', async () => {
    await run(seeded, "UPDATE person SET slug = 'real-teacher-zq' WHERE slug = 'demo-pro-sifu-8'");
    await run(seeded, "UPDATE auth_user SET email = 'someone-zq@example.com' WHERE email = 'demo-admin@example.test'");
    try {
      const error = await seedDatabase(seeded.url).then(
        () => null,
        (e: Error) => e,
      );
      expect(error?.message).toContain('2');
      expect(error?.message).not.toMatch(/zq|someone/);
    } finally {
      await run(seeded, "UPDATE person SET slug = 'demo-pro-sifu-8' WHERE slug = 'real-teacher-zq'");
      await run(seeded, "UPDATE auth_user SET email = 'demo-admin@example.test' WHERE email = 'someone-zq@example.com'");
    }
  });

  it('wipe a database that holds real-looking data only with WCR_ALLOW_WIPE=1', async () => {
    await run(seeded, "UPDATE person SET slug = 'real-teacher' WHERE slug = 'demo-pro-sifu-8'");
    await run(seeded, "UPDATE auth_user SET email = 'someone@example.com' WHERE email = 'demo-admin@example.test'");
    process.env[ALLOW_WIPE_VARIABLE] = 'yes';
    try {
      await expect(seedDatabase(seeded.url)).rejects.toThrow(/not demo data/);
      process.env[ALLOW_WIPE_VARIABLE] = '1';
      await seedDatabase(seeded.url);
    } finally {
      delete process.env[ALLOW_WIPE_VARIABLE];
    }
    // The demo data is back and the real-looking rows are gone.
    expect(await withClient(seeded.url, (c) => findNonDemoData(c))).toMatchObject({ accounts: 0 });
    expect(await sql<string>(seeded, "SELECT count(*) FROM person WHERE slug = 'real-teacher'")).toBe('0');
  });

  it('reset an empty database, and a demo database; reset a real-looking one only with WCR_ALLOW_WIPE=1', async () => {
    await resetDatabase(empty.url);
    await run(seeded, "UPDATE person SET slug = 'real-teacher' WHERE slug = 'demo-pro-sifu-8'");
    await expect(resetDatabase(seeded.url)).rejects.toThrow(/not demo data/);
    process.env[ALLOW_WIPE_VARIABLE] = '1';
    try {
      await resetDatabase(seeded.url);
    } finally {
      delete process.env[ALLOW_WIPE_VARIABLE];
    }
    expect(await sql<string | null>(seeded, "SELECT to_regclass('public.person')::text")).toBeNull();
  });
});
