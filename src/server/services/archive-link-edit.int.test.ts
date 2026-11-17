// archiveEditor.editLink (control panel 2026-11, docs/adr/0042-archive-link-edit.md), against a
// migrated throwaway database: who may correct a link (an archivist or an administrator with a
// verified second factor), the checks of the years, the source and the reason, the training period
// written in years (the school kept), the status and the history unchanged, the audit row (ids, years
// and lengths, never the source text), a member's link refused, and the public cache tags dropped.
// Fictional data only (D20): invented names.

import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { lineageTag, personTag } from '../cache';
import { getDb } from '../db';
import { auditLog, person, relationshipEvent, teachingRelationship, trainingPeriod } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import { addArchiveLink, createArchiveLineage, createArchiveRecord, editArchiveLink, MEMBER_LINK_EDIT, NOT_VERIFIED_EDIT } from './archive-editor';
import { archiveLinks } from './archive-grids';
import { createUser, key, member, meta, staff } from './relationships.test-support';

const cache = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: cache.revalidateTag,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
let archivist: Awaited<ReturnType<typeof staff>>;
let admin: Awaited<ReturnType<typeof staff>>;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  archivist = await staff('edit-archivist', 'archivist');
  admin = await staff('edit-admin', 'admin');
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

beforeEach(() => {
  cache.revalidateTag.mockClear();
});

async function failure(promise: Promise<unknown>): Promise<{ code: string; message?: string; fields?: Record<string, string> }> {
  return promise.then(
    () => ({ code: 'OK' }),
    (e: { code?: string; message?: string; fields?: Record<string, string> }) => ({ code: e.code ?? String(e), message: e.message, fields: e.fields }),
  );
}

let n = 0;
/** A verified link between two new records kept by the platform, 1850–1862, with a source. */
async function link() {
  n += 1;
  const letters = `${'ABCDEFGHIJ'[Math.floor(n / 10) % 10]}${'abcdefghij'[n % 10]}`;
  const record = (name: string) => createArchiveRecord(archivist.principal, { primaryName: name, lifeStatus: 'deceased', reason: 'A fictional register.' }, meta);
  const teacher = await record(`Demo Edit Teacher ${letters}`);
  const student = await record(`Demo Edit Student ${letters}`);
  const l = await createArchiveLineage(archivist.principal, { name: `Demo Edit Lineage ${letters}`, rootSlug: teacher.slug, reason: 'A fictional lineage.' }, meta);
  const added = await addArchiveLink(archivist.principal, { lineageId: l.id, teacherSlug: teacher.slug, studentSlug: student.slug, fromYear: 1850, toYear: 1862, source: 'A fictional chronicle, page 12.', idempotencyKey: key() }, meta);
  return { id: added.relationshipId, teacher, student, lineage: l };
}

const periodsOf = (id: string) =>
  getDb()
    .select({ startsOn: trainingPeriod.startsOn, endsOn: trainingPeriod.endsOn, precision: trainingPeriod.precision, schoolId: trainingPeriod.schoolId })
    .from(trainingPeriod)
    .where(eq(trainingPeriod.relationshipId, id))
    .orderBy(asc(trainingPeriod.sortOrder));

const editsOf = (id: string) =>
  getDb()
    .select({ action: auditLog.action, role: auditLog.actorRole, before: auditLog.before, after: auditLog.after, reason: auditLog.reason })
    .from(auditLog)
    .where(eq(auditLog.subjectId, id))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id))
    .then((rows) => rows.filter((r) => r.action === 'relationship.edit'));

describe('archiveEditor.editLink', () => {
  it('an archivist corrects the years and the source in place; the status, confirmation and events stay; the audit row has no source text; the public tags are dropped', async () => {
    const l = await link();
    const [before] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, l.id));
    const saved = await editArchiveLink(archivist.principal, { relationshipId: l.id, fromYear: '1851', toYear: 1860, source: 'A fictional chronicle, page 14.', reason: 'The page was misread.' }, meta);
    expect(saved).toEqual({ changed: true });
    const [after] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, l.id));
    expect(after).toMatchObject({ status: 'verified', visibility: 'public', verificationPath: 'committee_review', confirmedByUserId: before!.confirmedByUserId, sourceNote: 'A fictional chronicle, page 14.' });
    expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime());
    expect(await periodsOf(l.id)).toEqual([{ startsOn: '1851-01-01', endsOn: '1860-01-01', precision: 'year', schoolId: null }]);
    const events = await getDb().select({ to: relationshipEvent.toStatus }).from(relationshipEvent).where(eq(relationshipEvent.relationshipId, l.id));
    expect(events).toEqual([{ to: 'verified' }]);

    const [audit, ...more] = await editsOf(l.id);
    expect(more).toEqual([]);
    expect(audit).toMatchObject({
      role: 'archivist',
      reason: 'The page was misread.',
      before: { years: { from: 1850, to: 1862 }, periods: 1, source: { length: 31 } },
      after: { archiveEditor: true, status: 'verified', lineageId: l.lineage.id, changed: { years: true, source: true }, years: { from: 1851, to: 1860 }, source: { length: 31 } },
    });
    expect(JSON.stringify([audit!.before, audit!.after])).not.toMatch(/chronicle|Demo Edit/);

    const dropped = cache.revalidateTag.mock.calls.map((c) => c[0] as string);
    expect(dropped).toEqual(expect.arrayContaining([personTag(l.teacher.id), personTag(l.student.id), lineageTag(l.lineage.id), 'explore-start']));
    expect(cache.revalidateTag.mock.calls.every((c) => (c[1] as { expire?: number }).expire === 0)).toBe(true);

    const grid = await archiveLinks(archivist.principal, { slug: l.lineage.slug, link: l.id });
    expect(grid.selected).toMatchObject({ id: l.id, fromYear: 1851, toYear: 1860, source: 'A fictional chronicle, page 14.', status: 'verified', editable: true, endable: true });
  });

  it('an administrator may edit; only the source changed leaves the periods (and their school) as they are; nothing changed writes nothing', async () => {
    const l = await link();
    const [period] = await getDb().select({ id: trainingPeriod.id }).from(trainingPeriod).where(eq(trainingPeriod.relationshipId, l.id));
    const sourceOnly = await editArchiveLink(admin.principal, { relationshipId: l.id, fromYear: 1850, toYear: 1862, source: 'A fictional chronicle, second edition.', reason: 'The newer edition.' }, meta);
    expect(sourceOnly.changed).toBe(true);
    const [kept] = await getDb().select({ id: trainingPeriod.id }).from(trainingPeriod).where(eq(trainingPeriod.relationshipId, l.id));
    expect(kept!.id).toBe(period!.id);
    expect((await editsOf(l.id)).map((a) => [a.role, (a.after as { changed: unknown }).changed])).toEqual([['admin', { years: false, source: true }]]);

    cache.revalidateTag.mockClear();
    const same = await editArchiveLink(admin.principal, { relationshipId: l.id, fromYear: 1850, toYear: 1862, source: ' A fictional chronicle, second edition. ', reason: 'Again.' }, meta);
    expect(same).toEqual({ changed: false });
    expect(await editsOf(l.id)).toHaveLength(1);
    expect(cache.revalidateTag).not.toHaveBeenCalled();

    // Years cleared: one period whose dates are not known.
    await editArchiveLink(admin.principal, { relationshipId: l.id, fromYear: null, toYear: null, source: 'A fictional chronicle, second edition.', reason: 'The years are not in the source.' }, meta);
    expect(await periodsOf(l.id)).toEqual([{ startsOn: null, endsOn: null, precision: 'unknown', schoolId: null }]);
    const grid = await archiveLinks(archivist.principal, { slug: l.lineage.slug, link: l.id });
    expect(grid.selected).toMatchObject({ fromYear: null, toYear: null });
  });

  it('refuses a moderator, a member, a session without the second factor and no session', async () => {
    const l = await link();
    const input = { relationshipId: l.id, fromYear: 1851, toYear: 1860, source: 'A fictional chronicle.', reason: 'A fictional correction.' };
    const moderator = await staff('edit-moderator', 'moderator');
    const unconfirmed = await staff('edit-admin-no2fa', 'admin', { unverified: true });
    const someone = await member('edit-member');
    expect((await failure(editArchiveLink(moderator.principal, input, meta))).code).toBe('FORBIDDEN');
    expect((await failure(editArchiveLink(someone.principal, input, meta))).code).toBe('FORBIDDEN');
    expect((await failure(editArchiveLink(unconfirmed.principal, input, meta))).code).toBe('SECOND_FACTOR_REQUIRED');
    expect((await failure(editArchiveLink(null, input, meta))).code).toBe('UNAUTHORIZED');
    expect(await editsOf(l.id)).toEqual([]);
  });

  it('checks the years, the source and the reason as a new link does', async () => {
    const l = await link();
    const base = { relationshipId: l.id, fromYear: 1851, toYear: 1860, source: 'A fictional chronicle.', reason: 'A fictional correction.' };
    const thisYear = new Date().getUTCFullYear();
    const cases: [Record<string, unknown>, string][] = [
      [{ reason: ' ' }, 'reason'],
      [{ source: '' }, 'source'],
      [{ source: 'x'.repeat(2001) }, 'source'],
      [{ fromYear: 1500 }, 'fromYear'],
      [{ toYear: thisYear + 1 }, 'toYear'],
      [{ fromYear: null, toYear: 1860 }, 'fromYear'],
      [{ fromYear: 1860, toYear: 1851 }, 'toYear'],
      [{ fromYear: 'abc' }, 'fromYear'],
    ];
    for (const [change, field] of cases) {
      const outcome = await failure(editArchiveLink(archivist.principal, { ...base, ...change } as never, meta));
      expect([outcome.code, Object.keys(outcome.fields ?? {})]).toEqual(['BAD_REQUEST', [field]]);
    }
    expect((await failure(editArchiveLink(archivist.principal, { ...base, relationshipId: '0190d1c6-0000-7000-8000-000000000000' }, meta))).code).toBe('NOT_FOUND');
    expect(await editsOf(l.id)).toEqual([]);
  });

  it('refuses a member’s link (a member’s own record, or approved by the teacher) and a link not verified, and changes nothing', async () => {
    const input = (id: string) => ({ relationshipId: id, fromYear: 1851, toYear: 1860, source: 'A fictional chronicle, corrected.', reason: 'A fictional correction.' });
    const [claimed, approved, disputed] = [await link(), await link(), await link()];
    // The student's record was claimed by a member afterwards: now a member's own record.
    const claimer = await createUser('edit-claimer');
    await getDb().update(person).set({ stewardship: 'self', claimedByUserId: claimer.id }).where(eq(person.id, claimed.student.id));
    cache.revalidateTag.mockClear();
    expect(await failure(editArchiveLink(archivist.principal, input(claimed.id), meta))).toMatchObject({ code: 'CONFLICT', message: MEMBER_LINK_EDIT });

    await getDb().update(teachingRelationship).set({ verificationPath: 'teacher_approval' }).where(eq(teachingRelationship.id, approved.id));
    expect(await failure(editArchiveLink(admin.principal, input(approved.id), meta))).toMatchObject({ code: 'CONFLICT', message: MEMBER_LINK_EDIT });

    await getDb().update(teachingRelationship).set({ status: 'in_arbitration' }).where(eq(teachingRelationship.id, disputed.id));
    expect(await failure(editArchiveLink(archivist.principal, input(disputed.id), meta))).toMatchObject({ code: 'CONFLICT', message: NOT_VERIFIED_EDIT });

    for (const l of [claimed, approved, disputed]) {
      expect(await editsOf(l.id)).toEqual([]);
      const [row] = await getDb().select({ source: teachingRelationship.sourceNote }).from(teachingRelationship).where(eq(teachingRelationship.id, l.id));
      expect(row!.source).toBe('A fictional chronicle, page 12.');
      expect(await periodsOf(l.id)).toMatchObject([{ startsOn: '1850-01-01', endsOn: '1862-01-01' }]);
    }
    const grid = await archiveLinks(archivist.principal, { slug: claimed.lineage.slug, link: claimed.id });
    expect(grid.selected).toMatchObject({ editable: false, endable: false });
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });
});
