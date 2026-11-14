// The retention steps of review 2026-11 (docs/adr/0032-retention-and-withdrawal.md): a third party's
// record, the text of record revisions, ip_hmac, the evidence and notes of claims that ended without
// a verified link, and trial lesson requests nobody answered. Every step runs as app_rw, like the
// worker, on rows backdated with plain SQL, and is run twice to show that it is idempotent.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRoleDatabase, type Database } from '../db';
import { withClient } from '../db/admin';
import { rolePassword } from '../db/env';
import { PG, pgError, rows, value } from '../db/test-support';
import { createTestDatabase, type TestDatabase } from '../db/testing';
import type { ObjectStore } from '../storage';
import {
  closeStaleTrialInquiries,
  nullOldIpHmacs,
  NOTE_PURGED,
  PERSON_LIVE_TIES,
  PERSON_OWNED_TABLES,
  purgeEndedClaimData,
  purgeThirdPartyRecords,
  redactOldRevisions,
} from './retention-records';

let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createRoleDatabase('app_rw', testDb.url, rolePassword('app_rw'));
});

afterAll(async () => {
  await db?.$client.end();
  await testDb?.drop();
});

const hex = (n: number) => n.toString(16).padStart(64, '0');
const ago = (days: number) => `now() - interval '${days} days'`;

/** An object store in memory: the keys it holds, and the keys it refuses to delete. */
function memoryStore(keys: string[], refuse: string[] = []): ObjectStore & { keys: Set<string> } {
  const held = new Set(keys);
  return {
    driver: 'filesystem',
    keys: held,
    put: async (key) => void held.add(key),
    get: async () => null,
    delete: async (key) => {
      if (refuse.includes(key)) throw new Error('the store is down');
      held.delete(key);
    },
  };
}

// --- A third party's record ----------------------------------------------------------------------

describe('purgeThirdPartyRecords', () => {
  const ids: Record<string, string> = {};
  let lineageId: string;
  let creatorId: string;
  let teacherId: string;

  /** A record a member made for a third party, with its name, a search key and the audit row of its creation. */
  async function made(label: string, options: { reason?: string | null; createdDays?: number; set?: Record<string, string | null> } = {}): Promise<string> {
    const { reason = 'invited teacher', createdDays = 200, set = {} } = options;
    const columns: Record<string, string | null> = {
      slug: `demo-third-${label}`,
      kind: 'living',
      life_status: 'living',
      stewardship: 'unclaimed',
      visibility: 'involved_only',
      created_by_user_id: creatorId,
      ...set,
    };
    const names = Object.keys(columns);
    return withClient(testDb.url, async (c) => {
      const id = await value<string>(
        c,
        `INSERT INTO person (${names.join(', ')}, created_at, updated_at) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}, ${ago(createdDays)}, ${ago(createdDays)}) RETURNING id::text`,
        names.map((n) => columns[n]!),
      );
      const nameId = await value<string>(c, `INSERT INTO person_name (person_id, kind, value, script, lang, is_primary, sort_order) VALUES ($1, 'name', $2, 'Latn', 'und-Latn', true, 0) RETURNING id::text`, [id, `Demo Third ${label}`]);
      await c.query(`INSERT INTO person_name_key (person_id, person_name_id, key, key_kind, is_primary, source) VALUES ($1, $2, $3, 'latin', true, 'primary')`, [id, nameId, `demo third ${label}`]);
      if (reason) {
        await c.query(`INSERT INTO audit_log (action, actor_user_id, subject_type, subject_id, reason) VALUES ('person.create', $1, 'person', $2, $3)`, [creatorId, id, reason]);
      }
      ids[label] = id;
      return id;
    });
  }

  async function relation(personId: string, status: string, updatedDays: number): Promise<string> {
    return withClient(testDb.url, (c) =>
      value<string>(
        c,
        `INSERT INTO teaching_relationship (teacher_person_id, student_person_id, lineage_id, status, visibility, requested_by_user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'involved_only', $5, ${ago(updatedDays + 5)}, ${ago(updatedDays)}) RETURNING id::text`,
        [personId, teacherId, lineageId, status, creatorId],
      ),
    );
  }

  async function invitation(
    personId: string,
    relationshipId: string | null,
    status: string,
    expiresIn: number,
    n: number,
    { updatedDays = 120, withEmail = status === 'pending' }: { updatedDays?: number; withEmail?: boolean } = {},
  ): Promise<void> {
    await withClient(testDb.url, (c) =>
      c.query(
        `INSERT INTO invitation (person_id, relationship_id, invited_by_user_id, email, token_hash, status, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() + interval '${expiresIn} days', ${ago(120)}, ${ago(updatedDays)})`,
        [personId, relationshipId, creatorId, withEmail ? `demo-${n}@wingchunroots.test` : null, hex(n), status],
      ),
    );
  }

  beforeAll(async () => {
    await withClient(testDb.url, async (c) => {
      creatorId = await value<string>(c, `INSERT INTO auth_user (email, email_verified) VALUES ('demo-creator@wingchunroots.test', true) RETURNING id::text`);
      lineageId = await value<string>(c, `INSERT INTO lineage (slug, name) VALUES ('demo-third-lineage', 'Demo lineage') RETURNING id::text`);
      // The student of every request below: an ordinary record, not a third party's.
      teacherId = await value<string>(c, `INSERT INTO person (slug, kind) VALUES ('demo-third-student', 'living') RETURNING id::text`);
    });

    // Past retention: the claim ended 61 days ago.
    await made('refused');
    await relation(ids.refused!, 'rejected', 61);
    await withClient(testDb.url, async (c) => {
      // A history the relationship's append-only event table keeps: the record can only become a removed row.
      await c.query(`INSERT INTO relationship_event (relationship_id, from_status, to_status, actor_role) SELECT id, 'under_review', 'rejected', 'system' FROM teaching_relationship WHERE teacher_person_id = $1`, [ids.refused]);
      await c.query(`INSERT INTO record_revision (person_id, source, changed, before, after, reason) VALUES ($1, 'archival_edit', ARRAY['primaryName'], '{"primaryName":"Demo Third refused"}', '{"primaryName":"Demo Third refused two"}', 'demo reason')`, [ids.refused]);
    });
    // Without any relationship: deleted outright.
    await made('alone');
    await made('invited-gone', { createdDays: 300 });
    const waiting = await relation(ids['invited-gone']!, 'awaiting_claim', 100);
    await invitation(ids['invited-gone']!, waiting, 'expired', -70, 1);

    // Revoked by a resend 70 days ago (the address is erased since, which touched the row last): the revocation is past 60 days.
    await made('revoked-old');
    await invitation(ids['revoked-old']!, await relation(ids['revoked-old']!, 'withdrawn', 100), 'revoked', -90, 3, { updatedDays: 40, withEmail: false });
    await withClient(testDb.url, (c) => c.query(`UPDATE teaching_relationship SET updated_at = ${ago(70)} WHERE teacher_person_id = $1`, [ids['revoked-old']]));

    // Not due.
    // Revoked 10 days ago, its address still there: the invitation ended 10 days ago, not when it was created 120 days ago.
    await made('revoked-recent');
    await invitation(ids['revoked-recent']!, await relation(ids['revoked-recent']!, 'withdrawn', 100), 'revoked', -90, 4, { updatedDays: 10, withEmail: true });
    await made('recent');
    await relation(ids.recent!, 'withdrawn', 59);
    await made('verified');
    await relation(ids.verified!, 'verified', 400);
    await made('revoked');
    await relation(ids.revoked!, 'revoked', 400);
    await made('under-review');
    await relation(ids['under-review']!, 'under_review', 400);
    await made('pending-teacher');
    await relation(ids['pending-teacher']!, 'pending_teacher', 400);
    await made('awaiting-live');
    await invitation(ids['awaiting-live']!, await relation(ids['awaiting-live']!, 'awaiting_claim', 400), 'pending', 10, 2);
    await made('seed', { reason: null });
    await relation(ids.seed!, 'rejected', 400);
    await made('claimed', { set: { claimed_by_user_id: creatorId } });
    await relation(ids.claimed!, 'rejected', 400);
    await made('public', { set: { visibility: 'public' } });
    await made('taken-down');
    await withClient(testDb.url, (c) => c.query(`UPDATE person SET taken_down_at = now(), taken_down_reason = 'demo', taken_down_visibility = 'involved_only' WHERE slug = 'demo-third-taken-down'`));
    await made('lineage-root');
    await withClient(testDb.url, (c) => c.query(`UPDATE lineage SET root_person_id = $1 WHERE id = $2`, [ids['lineage-root'], lineageId]));
    await made('open-case');
    await withClient(testDb.url, (c) => c.query(`INSERT INTO review_case (kind, status, person_id) VALUES ('historical_claim', 'open', $1)`, [ids['open-case']]));
    await made('wrong-reason', { reason: 'archival record' });
    await made('pending-claim');
    await withClient(testDb.url, (c) => c.query(`INSERT INTO person_claim (person_id, user_id, status) VALUES ($1, $2, 'pending')`, [ids['pending-claim'], creatorId]));
  });

  it('deletes the records past 60 days and removes the one a relationship still refers to, and touches nothing else', async () => {
    const result = await purgeThirdPartyRecords(db);
    expect(result).toEqual({ deleted: 1, removed: 3, requestsWithdrawn: 1 });
    // Idempotent.
    expect(await purgeThirdPartyRecords(db)).toEqual({ deleted: 0, removed: 0, requestsWithdrawn: 0 });

    await withClient(testDb.url, async (c) => {
      const left = await rows<{ slug: string; deleted: boolean }>(c, `SELECT slug, deleted_at IS NOT NULL AS deleted FROM person WHERE slug LIKE 'demo-third-%' OR slug LIKE 'removed-%' ORDER BY slug`);
      const slugs = left.map((r) => r.slug);
      // Deleted outright: no relationship refers to them.
      expect(slugs).not.toContain('demo-third-alone');
      // Removed: the slug came from the name, so it is replaced.
      expect(slugs).not.toContain('demo-third-refused');
      expect(slugs).not.toContain('demo-third-invited-gone');
      expect(slugs).not.toContain('demo-third-revoked-old');
      expect(left.filter((r) => r.slug.startsWith('removed-'))).toEqual([
        { slug: `removed-${ids.refused!.replaceAll('-', '')}`, deleted: true },
        { slug: `removed-${ids['invited-gone']!.replaceAll('-', '')}`, deleted: true },
        { slug: `removed-${ids['revoked-old']!.replaceAll('-', '')}`, deleted: true },
      ].sort((a, b) => (a.slug < b.slug ? -1 : 1)));
      // Everything else stays, untouched.
      for (const label of ['recent', 'revoked-recent', 'verified', 'revoked', 'under-review', 'pending-teacher', 'awaiting-live', 'seed', 'claimed', 'public', 'taken-down', 'lineage-root', 'open-case', 'wrong-reason', 'pending-claim']) {
        expect(slugs, label).toContain(`demo-third-${label}`);
      }
      // No name, key or text of a removed record is left; its revisions are redacted at once.
      for (const gone of [ids.refused, ids['invited-gone'], ids.alone]) {
        expect(await value<number>(c, `SELECT ((SELECT count(*) FROM person_name WHERE person_id = $1) + (SELECT count(*) FROM person_name_key WHERE person_id = $1))::int`, [gone])).toBe(0);
      }
      expect(await rows(c, `SELECT before, after, reason, changed FROM record_revision WHERE person_id = $1`, [ids.refused])).toEqual([
        { before: { primaryName: '[redacted: 18 characters]', redacted: true }, after: { primaryName: '[redacted: 22 characters]', redacted: true }, reason: 'demo reason', changed: ['primaryName'] },
      ]);
      // The request that waited for the teacher is withdrawn, with an event, and the address of its invitation is gone.
      expect(await rows(c, `SELECT status FROM teaching_relationship WHERE teacher_person_id = $1`, [ids['invited-gone']])).toEqual([{ status: 'withdrawn' }]);
      expect(await rows(c, `SELECT from_status, to_status, actor_role, reason FROM relationship_event e JOIN teaching_relationship r ON r.id = e.relationship_id WHERE r.teacher_person_id = $1`, [ids['invited-gone']])).toEqual([
        { from_status: 'awaiting_claim', to_status: 'withdrawn', actor_role: 'system', reason: 'record_purged' },
      ]);
      expect(await value<number>(c, `SELECT count(*)::int FROM invitation WHERE person_id = $1 AND email IS NOT NULL`, [ids['invited-gone']])).toBe(0);
      // Untouched relationships.
      expect(await rows(c, `SELECT status FROM teaching_relationship WHERE teacher_person_id = $1`, [ids.verified])).toEqual([{ status: 'verified' }]);
      expect(await rows(c, `SELECT status FROM teaching_relationship WHERE teacher_person_id = $1`, [ids['awaiting-live']])).toEqual([{ status: 'awaiting_claim' }]);
      // Audited, with ids and outcomes only.
      expect(await rows(c, `SELECT subject_id, actor_role, after FROM audit_log WHERE action = 'person.purge' ORDER BY after->>'outcome', subject_id`)).toHaveLength(4);
      expect(await value<number>(c, `SELECT count(*)::int FROM audit_log WHERE action = 'person.purge' AND (before::text ~* 'demo' OR after::text ~* 'demo' OR reason ~* 'demo')`)).toBe(0);
    });
  });

  it('works in batches', async () => {
    for (let n = 0; n < 5; n += 1) {
      const id = await made(`batch-${n}`);
      await relation(id, 'withdrawn', 70);
    }
    expect(await purgeThirdPartyRecords(db, { batchSize: 2 })).toMatchObject({ removed: 5, deleted: 0 });
    expect(await purgeThirdPartyRecords(db, { batchSize: 2 })).toMatchObject({ removed: 0 });
  });

  it('takes the evidence of the record itself with it, and clears what a removed record said about the person', async () => {
    const gone = await made('ev-alone');
    const kept = await made('ev-removed', { set: { country_code: 'BG', training_start_year: '2001', birth_date: '1990-01-01' } });
    await relation(kept, 'withdrawn', 70);
    const file = (n: number) =>
      withClient(testDb.url, (c) =>
        value<string>(
          c,
          `INSERT INTO evidence_file (storage_key, sha256, original_sha256, mime, size_bytes, scan_status, original_name) VALUES ($1, $2, $2, 'application/pdf', 100, 'clean', $3) RETURNING id::text`,
          [`evidence/demoperson${n}`, hex(900 + n), `demo-person-${n}.pdf`],
        ),
      );
    const [onlyGone, shared, onlyKept] = [await file(1), await file(2), await file(3)] as [string, string, string];
    await withClient(testDb.url, async (c) => {
      const open = await value<string>(c, `INSERT INTO review_case (kind, status) VALUES ('historical_claim', 'open') RETURNING id::text`);
      await c.query(`INSERT INTO evidence_link (evidence_file_id, person_id, note) VALUES ($1, $2, 'demo note'), ($3, $2, 'demo note'), ($4, $5, 'demo note')`, [onlyGone, gone, shared, onlyKept, kept]);
      // One file is also evidence of a case that is still open: only the record's own link goes, the file stays.
      await c.query(`INSERT INTO evidence_link (evidence_file_id, review_case_id) VALUES ($1, $2)`, [shared, open]);
    });

    await purgeThirdPartyRecords(db);
    const store = memoryStore(['evidence/demoperson1', 'evidence/demoperson2', 'evidence/demoperson3']);
    const result = await purgeEndedClaimData(db, { evidenceStore: store });
    expect(result).toMatchObject({ files: 2, failed: 0 });
    expect([...store.keys]).toEqual(['evidence/demoperson2']);
    await withClient(testDb.url, async (c) => {
      expect(await rows(c, `SELECT storage_key, deleted_at IS NOT NULL AS deleted, retention_until IS NOT NULL AS stamped FROM evidence_file WHERE storage_key LIKE 'evidence/demoperson%' ORDER BY storage_key`)).toEqual([
        { storage_key: 'evidence/demoperson1', deleted: true, stamped: true },
        { storage_key: 'evidence/demoperson2', deleted: false, stamped: false },
        { storage_key: 'evidence/demoperson3', deleted: true, stamped: true },
      ]);
      expect(await value<number>(c, `SELECT count(*)::int FROM evidence_link WHERE person_id IN ($1, $2)`, [gone, kept])).toBe(0);
      expect(await rows(c, `SELECT country_code, training_start_year, birth_date, photo_id, place_id FROM person WHERE id = $1`, [kept])).toEqual([
        { country_code: null, training_start_year: null, birth_date: null, photo_id: null, place_id: null },
      ]);
    });
    // Idempotent.
    expect(await purgeEndedClaimData(db, { evidenceStore: store })).toMatchObject({ files: 0, failed: 0 });
  });

  it('knows every table that refers to a person: a new foreign key must be sorted in', async () => {
    await withClient(testDb.url, async (c) => {
      const referencing = await rows<{ t: string }>(c, `SELECT DISTINCT conrelid::regclass::text AS t FROM pg_constraint WHERE contype = 'f' AND confrelid = 'person'::regclass`);
      const known = new Set([...PERSON_LIVE_TIES.map(([table]) => table), ...PERSON_OWNED_TABLES]);
      expect(referencing.map((r) => r.t).filter((t) => !known.has(t))).toEqual([]);
      // And no listed table is a typo.
      for (const [table, ...columns] of PERSON_LIVE_TIES) {
        for (const column of columns) {
          expect(await value<number>(c, `SELECT count(*)::int FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [table, column]), `${table}.${column}`).toBe(1);
        }
      }
    });
  });
});

// --- Revisions and ip_hmac -----------------------------------------------------------------------

describe('redactOldRevisions', () => {
  it('redacts the text after 13 months and keeps who, when, which fields and why; app_rw cannot do more', async () => {
    let personId = '';
    await withClient(testDb.url, async (c) => {
      personId = await value<string>(c, `INSERT INTO person (slug, kind) VALUES ('demo-revision', 'living') RETURNING id::text`);
      await c.query(
        `INSERT INTO record_revision (person_id, source, changed, before, after, reason, created_at) VALUES
           ($1, 'archival_edit', ARRAY['primaryName', 'bio'], '{"primaryName":"Demo Old Name","bio":"A demo biography","lifeStatus":"living"}', '{"primaryName":"Demo New Name","bio":null,"lifeStatus":"living"}', 'old', now() - interval '14 months'),
           ($1, 'archival_edit', ARRAY['primaryName'], '{"primaryName":"Demo Recent"}', '{"primaryName":"Demo Recent Two"}', 'recent', now() - interval '12 months')`,
        [personId],
      );
    });
    expect(await redactOldRevisions(db)).toEqual({ revisions: 1 });
    expect(await redactOldRevisions(db)).toEqual({ revisions: 0 });
    await withClient(testDb.url, async (c) => {
      expect(await rows(c, `SELECT reason, changed, before, after FROM record_revision WHERE person_id = $1 ORDER BY created_at`, [personId])).toEqual([
        {
          reason: 'old',
          changed: ['primaryName', 'bio'],
          before: { primaryName: '[redacted: 13 characters]', bio: '[redacted: 16 characters]', lifeStatus: 'living', redacted: true },
          after: { primaryName: '[redacted: 13 characters]', bio: null, lifeStatus: 'living', redacted: true },
        },
        { reason: 'recent', changed: ['primaryName'], before: { primaryName: 'Demo Recent' }, after: { primaryName: 'Demo Recent Two' } },
      ]);
    });
    // The table stays append-only for the app: no UPDATE, no DELETE; the function refuses a recent cutoff.
    const appUpdate = await pgError(db.execute('UPDATE record_revision SET reason = reason' as never));
    expect(appUpdate.code).toBe(PG.insufficientPrivilege);
    const recentCutoff = await pgError(db.execute(`SELECT redact_record_revisions(now(), 10)` as never));
    expect(recentCutoff.code).toBe('22023');
  });

  it('works in batches', async () => {
    await withClient(testDb.url, async (c) => {
      const id = await value<string>(c, `INSERT INTO person (slug, kind) VALUES ('demo-revision-batches', 'living') RETURNING id::text`);
      await c.query(
        `INSERT INTO record_revision (person_id, source, changed, before, after, reason, created_at)
         SELECT $1, 'archival_edit', ARRAY['bio'], '{"bio":"demo text"}', '{"bio":"other demo text"}', 'n' || n, now() - interval '15 months' FROM generate_series(1, 5) AS n`,
        [id],
      );
    });
    expect(await redactOldRevisions(db, { batchSize: 2 })).toEqual({ revisions: 5 });
  });
});

describe('nullOldIpHmacs', () => {
  it('removes ip_hmac after 13 months from the audit log and from sessions, and changes nothing else', async () => {
    let userId = '';
    await withClient(testDb.url, async (c) => {
      userId = await value<string>(c, `INSERT INTO auth_user (email, email_verified) VALUES ('demo-ip@wingchunroots.test', true) RETURNING id::text`);
      await c.query(
        `INSERT INTO audit_log (action, subject_type, subject_id, reason, ip_hmac, occurred_at) VALUES
           ('demo.old', 'demo', 'a', 'kept reason', $1, now() - interval '14 months'),
           ('demo.old', 'demo', 'b', 'kept reason', $1, now() - interval '14 months'),
           ('demo.recent', 'demo', 'c', 'kept reason', $2, now() - interval '12 months'),
           ('demo.never', 'demo', 'd', 'kept reason', NULL, now() - interval '20 months')`,
        [hex(1), hex(2)],
      );
      await c.query(
        `INSERT INTO auth_session (token, user_id, expires_at, ip_address, created_at) VALUES
           ('demo-old', $1, now() + interval '1 day', $2, now() - interval '14 months'),
           ('demo-recent', $1, now() + interval '1 day', $2, now() - interval '12 months')`,
        [userId, hex(3)],
      );
    });
    expect(await nullOldIpHmacs(db, { batchSize: 1 })).toEqual({ audit: 2, sessions: 1 });
    expect(await nullOldIpHmacs(db)).toEqual({ audit: 0, sessions: 0 });
    await withClient(testDb.url, async (c) => {
      expect(await rows(c, `SELECT subject_id, action, reason, ip_hmac FROM audit_log WHERE subject_type = 'demo' ORDER BY subject_id`)).toEqual([
        { subject_id: 'a', action: 'demo.old', reason: 'kept reason', ip_hmac: null },
        { subject_id: 'b', action: 'demo.old', reason: 'kept reason', ip_hmac: null },
        { subject_id: 'c', action: 'demo.recent', reason: 'kept reason', ip_hmac: hex(2) },
        { subject_id: 'd', action: 'demo.never', reason: 'kept reason', ip_hmac: null },
      ]);
      expect(await rows(c, `SELECT token, ip_address FROM auth_session ORDER BY token`)).toEqual([
        { token: 'demo-old', ip_address: null },
        { token: 'demo-recent', ip_address: hex(3) },
      ]);
    });
  });

  it('keeps the audit log append-only for every other change, for every role', async () => {
    await withClient(testDb.url, async (c) => {
      await c.query(`INSERT INTO audit_log (action, subject_type, subject_id, reason, ip_hmac) VALUES ('demo.guard', 'demo', 'guard', 'reason', $1)`, [hex(9)]);
      // The owner of the table, who bypasses privileges, is stopped by the trigger.
      for (const change of [
        `UPDATE audit_log SET reason = 'changed' WHERE subject_id = 'guard'`,
        `UPDATE audit_log SET ip_hmac = NULL, reason = 'changed' WHERE subject_id = 'guard'`,
        `UPDATE audit_log SET ip_hmac = '${hex(8)}' WHERE subject_id = 'guard'`,
        `UPDATE audit_log SET ip_hmac = NULL, occurred_at = now() WHERE subject_id = 'guard'`,
        `DELETE FROM audit_log WHERE subject_id = 'guard'`,
        `TRUNCATE audit_log`,
      ]) {
        const error = await pgError(c.query(change));
        expect(error.message, change).toContain('audit_log is append-only');
      }
      // Only removing the value is allowed (a NULL cannot be turned back into a value either).
      await c.query(`UPDATE audit_log SET ip_hmac = NULL WHERE subject_id = 'guard'`);
      const back = await pgError(c.query(`UPDATE audit_log SET ip_hmac = '${hex(9)}' WHERE subject_id = 'guard'`));
      expect(back.message).toContain('audit_log is append-only');
    });
    // The app has no UPDATE privilege on the table at all; the function is its only way, and it refuses a recent cutoff.
    expect((await pgError(db.execute(`UPDATE audit_log SET ip_hmac = NULL` as never))).code).toBe(PG.insufficientPrivilege);
    expect((await pgError(db.execute(`SELECT null_old_audit_ip_hmac(now() - interval '10 days', 10)` as never))).code).toBe('22023');
  });
});

// --- Evidence and notes of claims that ended -----------------------------------------------------

describe('purgeEndedClaimData', () => {
  const files: Record<string, { id: string; key: string }> = {};
  const cases: Record<string, string> = {};

  async function file(label: string): Promise<void> {
    const key = `evidence/demo${label.replaceAll('-', '')}`;
    const id = await withClient(testDb.url, (c) =>
      value<string>(
        c,
        `INSERT INTO evidence_file (storage_key, sha256, original_sha256, mime, size_bytes, scan_status, original_name)
         VALUES ($1, $2, $2, 'application/pdf', 100, 'clean', $3) RETURNING id::text`,
        [key, hex(label.length * 1000 + label.charCodeAt(0)), `demo-${label}.pdf`],
      ),
    );
    files[label] = { id, key };
  }
  async function caseOf(label: string, kind: string, status: string, resolution: string | null, resolvedDays: number | null, relationshipId: string | null = null): Promise<void> {
    cases[label] = await withClient(testDb.url, (c) =>
      value<string>(
        c,
        `INSERT INTO review_case (kind, status, resolution, resolved_at, relationship_id, created_at)
         VALUES ($1, $2, $3, ${resolvedDays === null ? 'NULL' : ago(resolvedDays)}, $4, ${ago(400)}) RETURNING id::text`,
        [kind, status, resolution, relationshipId],
      ),
    );
  }
  const link = (label: string, target: { caseId?: string; relationshipId?: string; personId?: string }, note: string | null = 'demo note') =>
    withClient(testDb.url, (c) =>
      c.query(`INSERT INTO evidence_link (evidence_file_id, review_case_id, relationship_id, person_id, note) VALUES ($1, $2, $3, $4, $5)`, [
        files[label]!.id,
        target.caseId ?? null,
        target.relationshipId ?? null,
        target.personId ?? null,
        note,
      ]),
    );
  const note = (label: string, body: string) => withClient(testDb.url, (c) => c.query(`INSERT INTO review_note (review_case_id, body, is_internal) VALUES ($1, $2, true)`, [cases[label], body]));

  let store: ReturnType<typeof memoryStore>;

  beforeAll(async () => {
    let lineageId = '';
    let teacherId = '';
    let studentId = '';
    await withClient(testDb.url, async (c) => {
      lineageId = await value<string>(c, `INSERT INTO lineage (slug, name) VALUES ('demo-evidence-lineage', 'Demo lineage') RETURNING id::text`);
      teacherId = await value<string>(c, `INSERT INTO person (slug, kind) VALUES ('demo-evidence-teacher', 'living') RETURNING id::text`);
      studentId = await value<string>(c, `INSERT INTO person (slug, kind) VALUES ('demo-evidence-student', 'living') RETURNING id::text`);
    });
    const relation = (status: string, updatedDays: number, student = studentId) =>
      withClient(testDb.url, (c) =>
        value<string>(c, `INSERT INTO teaching_relationship (teacher_person_id, student_person_id, lineage_id, status, visibility, updated_at) VALUES ($1, $2, $3, $4, 'involved_only', ${ago(updatedDays)}) RETURNING id::text`, [teacherId, student, lineageId, status]),
      );
    const rejectedRelationship = await relation('rejected', 100);
    const verifiedRelationship = await relation('verified', 400);

    // Cases: refused 100 days ago (due), withdrawn 30 days ago (not yet), approved, open, other kind, refused but verified.
    await caseOf('refused-old', 'historical_claim', 'resolved', 'rejected', 100, rejectedRelationship);
    await caseOf('withdrawn-recent', 'person_claim', 'dismissed', null, 30);
    await caseOf('approved', 'historical_claim', 'resolved', 'approved', 400, verifiedRelationship);
    await caseOf('open', 'historical_claim', 'open', null, null);
    await caseOf('report', 'profile_report', 'resolved', 'rejected', 400);
    await caseOf('refused-but-verified', 'historical_claim', 'resolved', 'rejected', 400, verifiedRelationship);

    for (const label of ['due', 'recent', 'approved', 'both', 'person', 'unattached', 'report', 'verified-rel', 'rel-rejected']) await file(label);
    await link('due', { caseId: cases['refused-old']! });
    await link('recent', { caseId: cases['withdrawn-recent']! });
    await link('approved', { caseId: cases.approved! });
    await link('both', { caseId: cases['refused-old']! });
    await link('both', { caseId: cases.open! });
    await link('person', { personId: studentId });
    await link('report', { caseId: cases.report! });
    await link('verified-rel', { relationshipId: verifiedRelationship });
    await link('verified-rel', { caseId: cases['refused-but-verified']! });
    await link('rel-rejected', { relationshipId: rejectedRelationship });

    await note('refused-old', 'demo: a reviewer wrote about the claimant');
    await note('withdrawn-recent', 'demo: still inside the period');
    await note('approved', 'demo: approved claim');
    await note('open', 'demo: open claim');
    await note('report', 'demo: a report, not a claim');
    await note('refused-but-verified', 'demo: refused case, verified link');

    store = memoryStore(Object.values(files).map((f) => f.key));
  });

  it('stamps retention_until, deletes the due objects and rows, and removes the notes of ended claims only', async () => {
    const result = await purgeEndedClaimData(db, { evidenceStore: store });
    // due, both-links-ended? no (one link is open): due, recent, rel-rejected are stamped; due and rel-rejected are past 90 days.
    expect(result).toEqual({ stamped: 3, files: 2, notes: 1, failed: 0 });
    expect(await purgeEndedClaimData(db, { evidenceStore: store })).toEqual({ stamped: 0, files: 0, notes: 0, failed: 0 });

    // The objects of the two due files are gone from the private bucket; the rest are there.
    expect([...store.keys].sort()).toEqual(['due', 'rel-rejected'].reduce((keys, label) => keys.filter((k) => k !== files[label]!.key), Object.values(files).map((f) => f.key)).sort());

    await withClient(testDb.url, async (c) => {
      const state = await rows<{ storage_key: string; deleted: boolean; stamped: boolean; original_name: string | null; original_sha256: string | null }>(
        c,
        `SELECT storage_key, deleted_at IS NOT NULL AS deleted, retention_until IS NOT NULL AS stamped, original_name, original_sha256 FROM evidence_file ORDER BY storage_key`,
      );
      const byLabel = (label: string) => state.find((s) => s.storage_key === files[label]!.key)!;
      for (const label of ['due', 'rel-rejected']) expect(byLabel(label), label).toMatchObject({ deleted: true, stamped: true, original_name: null, original_sha256: null });
      expect(byLabel('recent')).toMatchObject({ deleted: false, stamped: true, original_name: 'demo-recent.pdf' });
      for (const label of ['approved', 'both', 'person', 'unattached', 'report', 'verified-rel']) {
        expect(byLabel(label), label).toMatchObject({ deleted: false, stamped: false, original_name: `demo-${label}.pdf` });
      }
      // retention_until is the end of the claim + 90 days.
      expect(await value<boolean>(c, `SELECT abs(extract(epoch FROM (retention_until - (now() - interval '100 days' + interval '90 days')))) < 120 FROM evidence_file WHERE id = $1`, [files.due!.id])).toBe(true);
      // The notes of the links of a deleted file are gone with it.
      expect(await value<number>(c, `SELECT count(*)::int FROM evidence_link WHERE evidence_file_id = $1 AND note IS NOT NULL`, [files.due!.id])).toBe(0);
      expect(await value<number>(c, `SELECT count(*)::int FROM evidence_link WHERE evidence_file_id = $1 AND note IS NOT NULL`, [files.recent!.id])).toBe(1);
      // Notes: only the refused claim's, which closed more than 90 days ago.
      const purged = async (label: string) => value<boolean>(c, `SELECT bool_and(body = $1) FROM review_note WHERE review_case_id = $2`, [NOTE_PURGED, cases[label]]);
      expect(await purged('refused-old')).toBe(true);
      for (const label of ['withdrawn-recent', 'approved', 'open', 'report', 'refused-but-verified']) expect(await purged(label), label).toBe(false);
      // Of the files of this describe (the purge of a third party's record, above, deleted two more).
      expect(await value<number>(c, `SELECT count(*)::int FROM audit_log WHERE action = 'evidence.purge' AND subject_id = ANY ($1::text[])`, [Object.values(files).map((f) => f.id)])).toBe(2);
    });
  });

  it('clears retention_until when a live claim comes to rest on the file, and deletes it later', async () => {
    await link('recent', { caseId: cases.open! });
    expect(await purgeEndedClaimData(db, { evidenceStore: store })).toEqual({ stamped: 0, files: 0, notes: 0, failed: 0 });
    await withClient(testDb.url, async (c) => {
      expect(await value<boolean>(c, `SELECT retention_until IS NULL FROM evidence_file WHERE id = $1`, [files.recent!.id])).toBe(true);
    });
  });

  it('keeps a file whose object the store would not delete, counts it, and fails when nothing could be deleted', async () => {
    await file('stuck');
    await link('stuck', { caseId: cases['refused-old']! });
    await file('stuck-two');
    await link('stuck-two', { caseId: cases['refused-old']! });
    const refusing = memoryStore([files.stuck!.key, files['stuck-two']!.key], [files.stuck!.key]);
    expect(await purgeEndedClaimData(db, { evidenceStore: refusing })).toEqual({ stamped: 2, files: 1, notes: 0, failed: 1 });
    await withClient(testDb.url, async (c) => {
      expect(await rows(c, `SELECT deleted_at IS NOT NULL AS deleted FROM evidence_file WHERE id IN ($1, $2) ORDER BY storage_key`, [files.stuck!.id, files['stuck-two']!.id])).toEqual([{ deleted: false }, { deleted: true }]);
    });
    const failure = await purgeEndedClaimData(db, { evidenceStore: refusing }).catch((e: Error) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).toBe('EvidenceStoreUnavailable');
    // The store comes back: the next run deletes it.
    expect(await purgeEndedClaimData(db, { evidenceStore: memoryStore([files.stuck!.key]) })).toEqual({ stamped: 0, files: 1, notes: 0, failed: 0 });
  });
});

// --- Trial lesson requests nobody answered -------------------------------------------------------

describe('closeStaleTrialInquiries', () => {
  it('closes and scrubs open requests older than 90 days and those of a school that is no longer there', async () => {
    const made: Record<string, string> = {};
    await withClient(testDb.url, async (c) => {
      const sender = await value<string>(c, `INSERT INTO auth_user (email, email_verified) VALUES ('demo-trial-sender@wingchunroots.test', true) RETURNING id::text`);
      const owner = await value<string>(c, `INSERT INTO auth_user (email, email_verified) VALUES ('demo-trial-owner@wingchunroots.test', true) RETURNING id::text`);
      const city = await value<string>(
        c,
        `INSERT INTO place (geonames_id, name, ascii_name, country_code, centroid) VALUES (999001, 'Demo City', 'Demo City', 'BG', ST_SetSRID(ST_MakePoint(23.3, 42.7), 4326)::geography) RETURNING id::text`,
      );
      const school = async (slug: string, status: string, deleted = false) =>
        value<string>(c, `INSERT INTO school (slug, name, place_id, public_point, status, created_by_user_id, deleted_at)
           VALUES ($1, 'Demo School', $2, (SELECT centroid FROM place WHERE id = $2), $3, $4, ${deleted ? 'now()' : 'NULL'}) RETURNING id::text`, [slug, city, status, owner]);
      const live = await school('demo-trial-live', 'active');
      const hidden = await school('demo-trial-hidden', 'hidden');
      const archived = await school('demo-trial-archived', 'archived', true);
      // The one-open-per-sender index: a different school each.
      const inquiry = async (label: string, schoolId: string, status: string, createdDays: number) => {
        made[label] = await value<string>(
          c,
          `INSERT INTO trial_inquiry (school_id, sender_user_id, sender_name, contact_method, contact_value, preferred_times, message, status, closed_at, created_at, updated_at)
           VALUES ($1, $2, 'Demo Sender', 'email', 'demo-trial-sender@wingchunroots.test', 'evenings', 'demo message', $3, ${status === 'open' ? 'NULL' : 'now()'}, ${ago(createdDays)}, ${ago(createdDays)}) RETURNING id::text`,
          [schoolId, sender, status],
        );
      };
      await inquiry('stale', live, 'open', 91);
      await inquiry('hidden', hidden, 'open', 1);
      await inquiry('archived', archived, 'open', 1);
      await inquiry('fresh', await school('demo-trial-other', 'active'), 'open', 89);
      await inquiry('answered', live, 'answered', 200);
    });
    expect(await closeStaleTrialInquiries(db)).toEqual({ stale: 1, schoolGone: 2 });
    expect(await closeStaleTrialInquiries(db)).toEqual({ stale: 0, schoolGone: 0 });
    await withClient(testDb.url, async (c) => {
      for (const label of ['stale', 'hidden', 'archived']) {
        expect(
          await rows(c, `SELECT status, sender_name, contact_value, preferred_times, message, reply, closed_at IS NOT NULL AS closed, scrubbed_at IS NOT NULL AS scrubbed FROM trial_inquiry WHERE id = $1`, [made[label]]),
          label,
        ).toEqual([{ status: 'closed', sender_name: null, contact_value: null, preferred_times: null, message: null, reply: null, closed: true, scrubbed: true }]);
      }
      expect(await rows(c, `SELECT status, sender_name, scrubbed_at IS NULL AS whole FROM trial_inquiry WHERE id = ANY($1::uuid[]) ORDER BY status`, [[made.fresh, made.answered]])).toEqual([
        { status: 'answered', sender_name: 'Demo Sender', whole: true },
        { status: 'open', sender_name: 'Demo Sender', whole: true },
      ]);
      // The table refuses a half-scrubbed or a scrubbed open row.
      expect((await pgError(c.query(`UPDATE trial_inquiry SET sender_name = NULL WHERE id = $1`, [made.fresh]))).code).toBe(PG.checkViolation);
    });
  });
});
