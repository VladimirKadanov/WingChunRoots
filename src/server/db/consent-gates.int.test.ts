// The life-status gate in the database (review 2026-11-14, docs/adr/0031-consent-and-living-gates.md):
// a person whose life status is unknown is treated as living and is never public, whichever code
// path writes it (CHECK person_unknown_not_public), and the migration's one-off step hides the
// records that were public with that status before the rule. Fictional data only (D20).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repoRoot } from './admin';
import { PG, pgError } from './test-support';
import { createTestDatabase, type TestDatabase } from './testing';

let db: TestDatabase;
let client: Client;
let app: Client;

beforeAll(async () => {
  db = await createTestDatabase();
  client = new Client({ connectionString: db.url });
  await client.connect();
  // The application role: the constraint holds for app_rw, not only for the owner.
  app = new Client({ connectionString: db.roleUrl('app_rw') });
  await app.connect();
});

afterAll(async () => {
  await client?.end();
  await app?.end();
  await db?.drop();
});

const insert = (c: Client, slug: string, lifeStatus: string, visibility: string) =>
  c.query(`INSERT INTO person (slug, kind, life_status, visibility, stewardship) VALUES ($1, 'historical', $2, $3, 'platform') RETURNING id`, [slug, lifeStatus, visibility]);

describe('person_unknown_not_public', () => {
  it('refuses a public person whose life status is unknown, on insert and on update, and lets the other states be public', async () => {
    expect((await pgError(insert(app, 'demo-gate-unknown-public', 'unknown', 'public'))).constraint).toBe('person_unknown_not_public');
    expect((await pgError(insert(app, 'demo-gate-unknown-public', 'unknown', 'public'))).code).toBe(PG.checkViolation);
    await insert(app, 'demo-gate-unknown-private', 'unknown', 'involved_only');
    await insert(app, 'demo-gate-deceased-public', 'deceased', 'public');
    await insert(app, 'demo-gate-living-public', 'living', 'public');
    // Neither path publishes an unknown record ...
    expect((await pgError(app.query(`UPDATE person SET visibility = 'public' WHERE slug = 'demo-gate-unknown-private'`))).constraint).toBe('person_unknown_not_public');
    // ... and a public record cannot be set back to unknown without hiding it first.
    expect((await pgError(app.query(`UPDATE person SET life_status = 'unknown' WHERE slug = 'demo-gate-deceased-public'`))).constraint).toBe('person_unknown_not_public');
    // Establishing a death is what lets it be published.
    await app.query(`UPDATE person SET life_status = 'deceased' WHERE slug = 'demo-gate-unknown-private'`);
    await app.query(`UPDATE person SET visibility = 'public' WHERE slug = 'demo-gate-unknown-private'`);
    const shown = await app.query<{ slug: string }>(`SELECT slug FROM person WHERE slug LIKE 'demo-gate-%' AND visibility = 'public' ORDER BY slug`);
    expect(shown.rows.map((r) => r.slug)).toEqual(['demo-gate-deceased-public', 'demo-gate-living-public', 'demo-gate-unknown-private']);
  });
});

describe('the migration of the rule hides the records that were public with an unknown life status', () => {
  it('hides them with an audit row and no membership, leaves everything else, and the constraint holds after it', async () => {
    const dir = readdirSync(path.join(repoRoot(), 'drizzle')).find((name) => name.endsWith('_review_consent_gates'));
    expect(dir).toBeDefined();
    const statements = readFileSync(path.join(repoRoot(), 'drizzle', dir!, 'migration.sql'), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(3);

    // The state before the migration: the constraint is not there yet.
    await client.query(`ALTER TABLE person DROP CONSTRAINT person_unknown_not_public`);
    const hiddenBefore = (await insert(client, 'demo-mig-unknown-public', 'unknown', 'public')).rows[0].id as string;
    const keptDeceased = (await insert(client, 'demo-mig-deceased-public', 'deceased', 'public')).rows[0].id as string;
    await insert(client, 'demo-mig-unknown-private', 'unknown', 'involved_only');
    await client.query(
      `INSERT INTO person_name (person_id, value, script, lang, is_primary) SELECT id, 'Demo ' || slug, 'Latn', 'en', true FROM person WHERE slug LIKE 'demo-mig-%'`,
    );
    await client.query(
        `INSERT INTO person (slug, kind, life_status, visibility, stewardship, taken_down_at, taken_down_reason, taken_down_visibility)
         VALUES ('demo-mig-unknown-held', 'historical', 'unknown', 'involved_only', 'platform', now(), 'A fictional hold.', 'public')`,
    );
    const lineage = (await client.query(`INSERT INTO lineage (slug, name) VALUES ('demo-mig-lineage', 'Demo Migration Lineage') RETURNING id`)).rows[0].id as string;
    await client.query(`INSERT INTO lineage_membership (lineage_id, person_id, depth) VALUES ($1, $2, 1), ($1, $3, 2)`, [lineage, hiddenBefore, keptDeceased]);

    for (const statement of statements) await client.query(statement);

    const people = await client.query<{ slug: string; visibility: string; taken_down_visibility: string | null }>(
      `SELECT slug, visibility, taken_down_visibility FROM person WHERE slug LIKE 'demo-mig-%' ORDER BY slug`,
    );
    expect(people.rows).toEqual([
      { slug: 'demo-mig-deceased-public', visibility: 'public', taken_down_visibility: null },
      { slug: 'demo-mig-unknown-held', visibility: 'involved_only', taken_down_visibility: 'involved_only' },
      { slug: 'demo-mig-unknown-private', visibility: 'involved_only', taken_down_visibility: null },
      { slug: 'demo-mig-unknown-public', visibility: 'involved_only', taken_down_visibility: null },
    ]);
    // Only the hidden person lost its membership rows.
    const members = await client.query<{ person_id: string }>(`SELECT person_id FROM lineage_membership WHERE lineage_id = $1`, [lineage]);
    expect(members.rows.map((r) => r.person_id)).toEqual([keptDeceased]);
    // One audit row for the one record that changed, with ids and shapes only.
    const audit = await client.query<{ subject_id: string; action: string; after: Record<string, unknown>; actor_user_id: string | null }>(
      `SELECT subject_id, action, after, actor_user_id FROM audit_log WHERE request_id = 'migration-review_consent_gates'`,
    );
    expect(audit.rows).toEqual([{ subject_id: hiddenBefore, action: 'person.update', after: { visibility: 'involved_only', lifeStatus: 'unknown', via: 'migration' }, actor_user_id: null }]);
    expect(JSON.stringify(audit.rows)).not.toContain('Demo');
    // The constraint is back.
    expect((await pgError(insert(app, 'demo-mig-after', 'unknown', 'public'))).constraint).toBe('person_unknown_not_public');
  });
});
