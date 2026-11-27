// Journey review P2-10 (docs/adr/0086-archive-duplicates.md): merging a record entered twice, and the
// common roots kept once. Against a migrated throwaway database; fictional data only (D20).

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import type { TestDatabase } from '../db/testing';
import { addArchiveLink, COMMON_ROOTS_LINK, createArchiveLineage, createArchiveRecord, updateArchiveLineage } from './archive-editor';
import { MERGE_LINKED, MERGE_MEMBER, mergeArchiveRecord } from './archive-merge';
import { mergedRecordTarget } from './archive-redirect';
import { key, member, meta, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
let archivist: Awaited<ReturnType<typeof staff>>;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  archivist = await staff('merge-archivist', 'archivist');
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

async function refusal(promise: Promise<unknown>): Promise<{ code?: string; fields?: Record<string, string> }> {
  return promise.then(
    () => ({ code: 'OK' }),
    (e: unknown) => e as { code?: string; fields?: Record<string, string> },
  );
}

const record = (primaryName: string, extra: Record<string, string> = {}) =>
  createArchiveRecord(archivist.principal, { primaryName, lifeStatus: 'deceased', reason: 'A fictional register.', ...extra }, meta);

const link = (lineageId: string, teacherSlug: string, studentSlug: string) =>
  addArchiveLink(archivist.principal, { lineageId, teacherSlug, studentSlug, fromYear: 1900, source: 'A fictional chronicle.', idempotencyKey: key() }, meta);

async function linksOf(personId: string) {
  const rows = await getDb().execute<{ teacher: string; student: string; status: string; reason: string | null }>(sql`
    SELECT teacher_person_id::text AS teacher, student_person_id::text AS student, status, status_reason AS reason
      FROM teaching_relationship WHERE teacher_person_id = ${personId}::uuid OR student_person_id = ${personId}::uuid ORDER BY created_at, id`);
  return rows.rows;
}

describe('archive merge', () => {
  it('moves the links, names and lineage root to the kept record, ends a shared link and leaves the address', async () => {
    const teacher = await record('Demo Merge Teacher');
    const kept = await record('Demo Merge Kept', { originalName: '演示合併', originalLang: 'zh-Hant' });
    const twin = await record('Demo Merge Twin', { jyutping: 'jin2 si6 hap6 bing3' });
    const student = await record('Demo Merge Student');
    const line = await createArchiveLineage(archivist.principal, { name: 'Demo Merge Lineage', rootSlug: twin.slug, reason: 'A fictional lineage.' }, meta);
    await link(line.id, teacher.slug, kept.slug);
    await link(line.id, teacher.slug, twin.slug);
    await link(line.id, twin.slug, student.slug);

    const result = await mergeArchiveRecord(archivist.principal, { fromSlug: twin.slug, intoSlug: kept.slug, reason: 'The same fictional teacher, entered twice.' }, meta);
    expect(result).toMatchObject({ slug: kept.slug, movedLinks: 1, endedLinks: 1, movedNames: 2 });

    const keptLinks = await linksOf(kept.id);
    expect(keptLinks.filter((l) => l.status === 'verified').map((l) => [l.teacher, l.student])).toEqual([
      [teacher.id, kept.id],
      [kept.id, student.id],
    ]);
    // The duplicate link ended, with its history, on the old record.
    expect(await linksOf(twin.id)).toEqual([{ teacher: teacher.id, student: twin.id, status: 'revoked', reason: 'merge' }]);
    const names = await getDb().execute<{ value: string; kind: string; is_primary: boolean }>(sql`SELECT value, kind, is_primary FROM person_name WHERE person_id = ${kept.id}::uuid ORDER BY sort_order`);
    expect(names.rows.map((n) => [n.value, n.kind, n.is_primary])).toEqual([
      ['Demo Merge Kept', 'name', true],
      ['演示合併', 'name', false],
      ['Demo Merge Twin', 'alias', false],
      ['jin2 si6 hap6 bing3', 'romanization', false],
    ]);
    const keys = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM person_name_key WHERE person_id = ${kept.id}::uuid AND key = 'demo merge twin'`);
    expect(keys.rows[0]?.n).toBe(1);
    const root = await getDb().execute<{ root: string }>(sql`SELECT root_person_id::text AS root FROM lineage WHERE id = ${line.id}::uuid`);
    expect(root.rows[0]?.root).toBe(kept.id);
    const gone = await getDb().execute<{ deleted: boolean }>(sql`SELECT deleted_at IS NOT NULL AS deleted FROM person WHERE id = ${twin.id}::uuid`);
    expect(gone.rows[0]?.deleted).toBe(true);
    const redirect = await getDb().execute<{ person_id: string }>(sql`SELECT person_id::text FROM person_redirect WHERE from_slug = ${twin.slug}`);
    expect(redirect.rows[0]?.person_id).toBe(kept.id);
    // The kept record is public now (its links are verified): the old address answers with it.
    expect(await mergedRecordTarget(twin.slug)).toBe(kept.slug);
    expect(await mergedRecordTarget('demo-no-such-record')).toBeNull();
    const audit = await getDb().execute<{ after: unknown }>(sql`SELECT after FROM audit_log WHERE action = 'person.merge' AND subject_id = ${twin.id}`);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0])).not.toContain('Demo Merge');
  });

  it('makes a kept record without links public and moves the biography in a language it lacks', async () => {
    const teacher = await record('Demo Merge Bio Teacher');
    const twin = await record('Demo Merge Bio Twin');
    const kept = await record('Demo Merge Bio Kept');
    const line = await createArchiveLineage(archivist.principal, { name: 'Demo Merge Bio Lineage', rootSlug: teacher.slug, reason: 'A fictional lineage.' }, meta);
    await link(line.id, teacher.slug, twin.slug);
    await getDb().execute(sql`INSERT INTO person_bio (person_id, lang, body) VALUES (${twin.id}::uuid, 'en', 'A fictional biography.'), (${twin.id}::uuid, 'bg', 'Измислена биография.'), (${kept.id}::uuid, 'bg', 'Своя биография.')`);
    const visibility = async () => (await getDb().execute<{ v: string }>(sql`SELECT visibility AS v FROM person WHERE id = ${kept.id}::uuid`)).rows[0]?.v;
    expect(await visibility()).not.toBe('public');

    await mergeArchiveRecord(archivist.principal, { fromSlug: twin.slug, intoSlug: kept.slug, reason: 'The same fictional student, entered twice.' }, meta);
    expect(await visibility()).toBe('public');
    expect(await mergedRecordTarget(twin.slug)).toBe(kept.slug);
    const bios = await getDb().execute<{ lang: string; body: string }>(sql`SELECT lang, body FROM person_bio WHERE person_id = ${kept.id}::uuid ORDER BY lang`);
    expect(bios.rows).toEqual([
      { lang: 'bg', body: 'Своя биография.' },
      { lang: 'en', body: 'A fictional biography.' },
    ]);
  });

  it('refuses a member’s record, two linked records, the same record and other roles', async () => {
    const a = await record('Demo Merge Linked A');
    const b = await record('Demo Merge Linked B');
    const line = await createArchiveLineage(archivist.principal, { name: 'Demo Merge Refusals', reason: 'A fictional lineage.' }, meta);
    await link(line.id, a.slug, b.slug);
    expect((await refusal(mergeArchiveRecord(archivist.principal, { fromSlug: a.slug, intoSlug: b.slug, reason: 'Fictional.' }, meta))).fields?.intoSlug).toBe(MERGE_LINKED);
    expect((await refusal(mergeArchiveRecord(archivist.principal, { fromSlug: a.slug, intoSlug: a.slug, reason: 'Fictional.' }, meta))).code).toBe('BAD_REQUEST');
    const someone = await member('merge-member');
    const own = await getDb().execute<{ slug: string }>(sql`SELECT slug FROM person WHERE claimed_by_user_id = ${someone.principal.user.id}`);
    if (own.rows[0]) {
      expect((await refusal(mergeArchiveRecord(archivist.principal, { fromSlug: own.rows[0].slug, intoSlug: a.slug, reason: 'Fictional.' }, meta))).fields?.fromSlug).toBe(MERGE_MEMBER);
    }
    expect((await refusal(mergeArchiveRecord(someone.principal, { fromSlug: a.slug, intoSlug: b.slug, reason: 'Fictional.' }, meta))).code).toBe('FORBIDDEN');
    const moderator = await staff('merge-moderator', 'moderator');
    expect((await refusal(mergeArchiveRecord(moderator.principal, { fromSlug: a.slug, intoSlug: b.slug, reason: 'Fictional.' }, meta))).code).toBe('FORBIDDEN');
  });

  it('keeps a link of the common roots once', async () => {
    const elder = await record('Demo Common Elder');
    const heir = await record('Demo Common Heir');
    const shared = await createArchiveLineage(archivist.principal, { name: 'Demo Common Roots', rootSlug: elder.slug, reason: 'A fictional lineage.' }, meta);
    const branch = await createArchiveLineage(archivist.principal, { name: 'Demo Common Branch', rootSlug: heir.slug, reason: 'A fictional lineage.' }, meta);
    await updateArchiveLineage(archivist.principal, { lineageId: shared.id, name: 'Demo Common Roots', description: null, rootSlug: elder.slug, commonRoots: true, reason: 'Fictional.' }, meta);
    await link(shared.id, elder.slug, heir.slug);
    const twice = await refusal(link(branch.id, elder.slug, heir.slug));
    expect(twice.code).toBe('CONFLICT');
    expect(twice.fields?.studentSlug).toBe(COMMON_ROOTS_LINK);
    // One lineage at a time holds the common roots.
    await updateArchiveLineage(archivist.principal, { lineageId: branch.id, name: 'Demo Common Branch', description: null, rootSlug: heir.slug, commonRoots: true, reason: 'Fictional.' }, meta);
    const flags = await getDb().execute<{ id: string }>(sql`SELECT id::text FROM lineage WHERE common_roots`);
    expect(flags.rows.map((r) => r.id)).toEqual([branch.id]);
  });
});
