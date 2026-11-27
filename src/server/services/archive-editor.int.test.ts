// The archive editor (milestone M26, docs/adr/0034-archive-editor.md), against a migrated throwaway
// database: who may use it (an archivist or an administrator with a verified second factor), new
// lineages and historical records (private until a link is verified, found by every spelling in the
// staff search), verified links with their sources (the cycle, duplicate and member checks; both
// ends published where publication.ts allows; an unknown life status stays hidden), the lineage
// view, a lineage's root and name, ending a link entered by mistake, and the audit rows (ids and
// lengths, never a name or a source). Fictional data only (D20): demo- slugs and invented names.

import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import { auditLog, person, personName, relationshipEvent, teachingRelationship, trainingPeriod } from '../db/schema';
import type { TestDatabase } from '../db/testing';
import {
  addArchiveLink,
  createArchiveLineage,
  createArchiveRecord,
  editArchiveLink,
  endArchiveLink,
  getArchiveLineage,
  listArchiveLineages,
  searchArchiveRecords,
  updateArchiveLineage,
} from './archive-editor';
import { getArchiveRecord, updateArchiveRecord } from './review';
import { key, member, meta, staff } from './relationships.test-support';

vi.mock('next/cache', () => ({
  cacheTag: () => undefined,
  cacheLife: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
}));

let testDb: TestDatabase | undefined;
let archivist: Awaited<ReturnType<typeof staff>>;
let admin: Awaited<ReturnType<typeof staff>>;

beforeAll(async () => {
  testDb = await startAuthTestDatabase();
  archivist = await staff('m26-archivist', 'archivist');
  admin = await staff('m26-admin', 'admin');
});

afterAll(async () => {
  await stopAuthTestDatabase(testDb);
});

async function code(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'OK',
    (e: unknown) => (e as { code?: string }).code ?? String(e),
  );
}

async function fields(promise: Promise<unknown>): Promise<Record<string, string>> {
  return promise.then(
    () => ({}),
    (e: unknown) => (e as { fields?: Record<string, string> }).fields ?? {},
  );
}

async function record(name: string, lifeStatus: 'deceased' | 'unknown' = 'deceased', who = archivist) {
  return createArchiveRecord(who.principal, { primaryName: name, lifeStatus, reason: 'A fictional register.' }, meta);
}

async function lineageOf(name: string, rootSlug: string | null = null) {
  return createArchiveLineage(archivist.principal, { name, rootSlug, reason: 'A fictional lineage for the tests.' }, meta);
}

async function isPublicPerson(id: string): Promise<boolean> {
  const result = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_person WHERE id = ${id}::uuid`);
  return result.rows[0]!.n === 1;
}

async function isPublicEdge(teacherId: string, studentId: string): Promise<boolean> {
  const result = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM v_public_edge WHERE teacher_person_id = ${teacherId}::uuid AND student_person_id = ${studentId}::uuid`);
  return result.rows[0]!.n === 1;
}

async function auditsOf(subjectId: string) {
  return getDb()
    .select({ action: auditLog.action, actor: auditLog.actorUserId, role: auditLog.actorRole, after: auditLog.after, reason: auditLog.reason, evidenceIds: auditLog.evidenceIds })
    .from(auditLog)
    .where(eq(auditLog.subjectId, subjectId))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
}

describe('who may use the archive editor', () => {
  it('an archivist and an administrator with the second factor; a moderator, a member and an unconfirmed session are refused', async () => {
    const moderator = await staff('m26-moderator', 'moderator');
    const unconfirmed = await staff('m26-admin-no2fa', 'admin', { unverified: true });
    const someone = await member('m26-member');
    expect(await code(listArchiveLineages(archivist.principal))).toBe('OK');
    expect(await code(listArchiveLineages(admin.principal))).toBe('OK');
    expect(await code(listArchiveLineages(moderator.principal))).toBe('FORBIDDEN');
    expect(await code(listArchiveLineages(someone.principal))).toBe('FORBIDDEN');
    expect(await code(listArchiveLineages(unconfirmed.principal))).toBe('SECOND_FACTOR_REQUIRED');
    expect(await code(listArchiveLineages(null))).toBe('UNAUTHORIZED');
    expect(await code(record('Demo Moderator Record', 'deceased', moderator))).toBe('FORBIDDEN');
  });

  it('an administrator edits an archival record too (the owner’s decision for M26)', async () => {
    const r = await record('Demo Admin Edited Record');
    const view = await getArchiveRecord(admin.principal, { slug: r.slug });
    expect(view.editable).toBe(true);
    const saved = await updateArchiveRecord(admin.principal, { personId: r.id, primaryName: 'Demo Admin Edited Record Two', lifeStatus: 'deceased', reason: 'A fictional correction.', evidenceIds: [] }, meta);
    expect(saved.changed).toBe(true);
    expect((await auditsOf(r.id)).map((a) => [a.action, a.role])).toEqual([
      ['person.create', 'archivist'],
      ['person.update', 'admin'],
    ]);
  });
});

describe('records', () => {
  it('a historical record kept by the platform, private, with every spelling, found by the staff search; the audit row names no name', async () => {
    const created = await createArchiveRecord(
      archivist.principal,
      {
        primaryName: 'Demo Archive Founder',
        originalName: '演示祖師',
        originalLang: 'zh-Hant',
        jyutping: 'jin2 si6 zou2 si1',
        pinyin: 'Yǎnshì Zǔshī',
        lifeStatus: 'deceased',
        bio: 'A fictional founder, invented for the tests.',
        reason: 'A fictional register, page 1.',
      },
      meta,
    );
    expect(created.slug).toMatch(/^demo-archive-founder-[0-9a-f]{8}$/);
    const [row] = await getDb().select().from(person).where(eq(person.id, created.id));
    expect(row).toMatchObject({ kind: 'historical', stewardship: 'platform', visibility: 'involved_only', lifeStatus: 'deceased', createdByUserId: archivist.account.id });
    const names = await getDb().select({ kind: personName.kind, lang: personName.lang, romanization: personName.romanization, isPrimary: personName.isPrimary }).from(personName).where(eq(personName.personId, created.id)).orderBy(asc(personName.sortOrder));
    expect(names).toEqual([
      { kind: 'name', lang: 'und-Latn', romanization: null, isPrimary: true },
      { kind: 'name', lang: 'zh-Hant', romanization: null, isPrimary: false },
      { kind: 'romanization', lang: 'yue-Latn', romanization: 'jyutping', isPrimary: false },
      { kind: 'romanization', lang: 'zh-Latn-pinyin', romanization: 'pinyin', isPrimary: false },
    ]);
    expect(await isPublicPerson(created.id)).toBe(false);
    for (const q of ['演示祖師', 'jin2 si6', 'archive founder', created.slug]) {
      expect((await searchArchiveRecords(archivist.principal, { q })).records.map((r) => r.id)).toContain(created.id);
    }
    expect((await searchArchiveRecords(archivist.principal, { q: 'x' })).records).toEqual([]);
    const [audit] = await auditsOf(created.id);
    expect(audit).toMatchObject({ action: 'person.create', actor: archivist.account.id, role: 'archivist', reason: 'A fictional register, page 1.' });
    expect(JSON.stringify(audit!.after)).not.toMatch(/Founder|演示|jin2|fictional founder/);
  });

  it('refuses a name not in Latin letters, a mismatched script, bad Jyutping, a missing reason and a living status', async () => {
    const refused = await fields(createArchiveRecord(archivist.principal, { primaryName: '演示', originalName: 'Demo', originalLang: 'zh-Hant', jyutping: 'Not Jyutping!', lifeStatus: 'deceased', reason: ' ' }, meta));
    expect(Object.keys(refused).sort()).toEqual(['jyutping', 'originalName', 'primaryName', 'reason']);
    expect(await code(createArchiveRecord(archivist.principal, { primaryName: 'Demo Living', lifeStatus: 'living' as 'deceased', reason: 'A fictional register.' }, meta))).toBe('BAD_REQUEST');
  });
});

describe('lineages', () => {
  it('creates a lineage with a slug from its name, refuses a taken name and a member’s record as the root, and audits the reason', async () => {
    const root = await record('Demo Lineage Root One');
    const created = await lineageOf('Demo Archive Lineage One', root.slug);
    expect(created.slug).toBe('demo-archive-lineage-one');
    expect(await fields(lineageOf('demo archive lineage one'))).toEqual({ name: expect.stringContaining('exists already') });
    const owner = await member('m26-lineage-root');
    expect(await fields(lineageOf('Demo Archive Lineage Member Root', owner.slug))).toEqual({ rootSlug: expect.stringContaining('member') });
    expect(await fields(lineageOf('Demo Archive Lineage Missing Root', 'demo-no-such-record'))).toEqual({ rootSlug: expect.stringContaining('No record') });
    expect(await fields(lineageOf('演示'))).toEqual({ name: 'Use Latin letters here.' });
    const [audit] = await auditsOf(created.id);
    expect(audit).toMatchObject({ action: 'lineage.create', role: 'archivist', reason: 'A fictional lineage for the tests.', after: { slug: created.slug, rootPersonId: root.id } });
    const view = await getArchiveLineage(archivist.principal, { slug: created.slug });
    expect(view).toMatchObject({ name: 'Demo Archive Lineage One', root: { id: root.id, shown: false }, listed: false, links: [] });
  });

  it('renames a lineage and changes its root; nothing changed writes nothing', async () => {
    const first = await record('Demo Rename Root One');
    const second = await record('Demo Rename Root Two');
    const l = await lineageOf('Demo Archive Lineage Rename', first.slug);
    const same = await updateArchiveLineage(archivist.principal, { lineageId: l.id, name: 'Demo Archive Lineage Rename', rootSlug: first.slug, reason: 'Nothing.' }, meta);
    expect(same).toEqual({ slug: l.slug, changed: false });
    const changed = await updateArchiveLineage(admin.principal, { lineageId: l.id, name: 'Demo Archive Lineage Renamed', description: 'A fictional description.', rootSlug: second.slug, reason: 'A fictional correction.' }, meta);
    expect(changed).toEqual({ slug: l.slug, changed: true });
    const view = await getArchiveLineage(archivist.principal, { slug: l.slug });
    expect(view).toMatchObject({ name: 'Demo Archive Lineage Renamed', description: 'A fictional description.', root: { id: second.id } });
    const audits = await auditsOf(l.id);
    expect(audits.map((a) => a.action)).toEqual(['lineage.create', 'lineage.update']);
    expect(audits[1]).toMatchObject({ role: 'admin', reason: 'A fictional correction.', after: { changed: { name: true, description: true, root: true }, rootPersonId: second.id } });
  });
});

describe('links', () => {
  it('records a verified link with its source and years; both records become public; the explorer lists the lineage; a second call with the key changes nothing', async () => {
    const teacher = await record('Demo Link Teacher');
    const student = await record('Demo Link Student');
    const l = await lineageOf('Demo Archive Lineage Links', teacher.slug);
    const idempotencyKey = key();
    const input = { lineageId: l.id, teacherSlug: teacher.slug, studentSlug: student.slug, fromYear: 1850, toYear: '1862', source: 'A fictional chronicle, page 12.', idempotencyKey };
    const added = await addArchiveLink(archivist.principal, input, meta);
    expect(added).toMatchObject({ shown: true, replayed: false });
    const [rel] = await getDb().select().from(teachingRelationship).where(eq(teachingRelationship.id, added.relationshipId));
    expect(rel).toMatchObject({ status: 'verified', visibility: 'public', verificationPath: 'committee_review', sourceNote: 'A fictional chronicle, page 12.', confirmedByUserId: archivist.account.id, isDisplayPrimary: true });
    const periods = await getDb().select().from(trainingPeriod).where(eq(trainingPeriod.relationshipId, added.relationshipId));
    expect(periods).toMatchObject([{ startsOn: '1850-01-01', endsOn: '1862-01-01', precision: 'year', ongoing: false }]);
    expect(await isPublicPerson(teacher.id)).toBe(true);
    expect(await isPublicPerson(student.id)).toBe(true);
    expect(await isPublicEdge(teacher.id, student.id)).toBe(true);
    const events = await getDb().select({ from: relationshipEvent.fromStatus, to: relationshipEvent.toStatus, role: relationshipEvent.actorRole, reason: relationshipEvent.reason }).from(relationshipEvent).where(eq(relationshipEvent.relationshipId, added.relationshipId));
    expect(events).toEqual([{ from: null, to: 'verified', role: 'archivist', reason: 'archive' }]);
    const [audit] = await auditsOf(added.relationshipId);
    expect(audit).toMatchObject({ action: 'relationship.verify', after: { archiveEditor: true, years: { from: 1850, to: 1862 }, source: { length: 31 }, shown: true } });
    expect(JSON.stringify(audit!.after)).not.toContain('chronicle');

    const again = await addArchiveLink(archivist.principal, input, meta);
    expect(again).toMatchObject({ relationshipId: added.relationshipId, replayed: true });
    expect(await code(addArchiveLink(archivist.principal, { ...input, idempotencyKey: key() }, meta))).toBe('CONFLICT');

    const view = await getArchiveLineage(archivist.principal, { slug: l.slug });
    expect(view.listed).toBe(true);
    expect(view.links).toMatchObject([{ id: added.relationshipId, status: 'verified', shown: true, fromYear: 1850, toYear: 1862, source: 'A fictional chronicle, page 12.', endable: true }]);
    const listed = (await listArchiveLineages(archivist.principal)).lineages.find((x) => x.id === l.id);
    expect(listed).toMatchObject({ links: 1, listed: true, root: { id: teacher.id, shown: true } });
  });

  it('keeps how sure the record is, the public source line and the era; the public views show them and never the staff source (P1-3)', async () => {
    const created = await createArchiveRecord(archivist.principal, { primaryName: 'Demo Era Teacher', lifeStatus: 'deceased', era: 'active 1850s to 1880s', reason: 'A fictional register.' }, meta);
    const student = await record('Demo Era Student');
    const l = await lineageOf('Demo Archive Lineage Certainty');
    const added = await addArchiveLink(
      archivist.principal,
      { lineageId: l.id, teacherSlug: created.slug, studentSlug: student.slug, source: 'A fictional staff note.', certainty: 'traditional', publicSource: 'the fictional hall chronicle', idempotencyKey: key() },
      meta,
    );
    const edge = await getDb().execute<{ certainty: string; public_source: string }>(sql`SELECT * FROM v_public_edge WHERE id = ${added.relationshipId}::uuid`);
    expect(edge.rows[0]).toMatchObject({ certainty: 'traditional', public_source: 'the fictional hall chronicle' });
    expect(JSON.stringify(edge.rows[0])).not.toContain('staff note');
    const shown = await getDb().execute<{ era_text: string }>(sql`SELECT era_text FROM v_public_person WHERE id = ${created.id}::uuid`);
    expect(shown.rows[0]).toEqual({ era_text: 'active 1850s to 1880s' });
    // Editing changes the certainty; a missing certainty is "documented".
    expect(await addArchiveLink(archivist.principal, { lineageId: l.id, teacherSlug: created.slug, studentSlug: (await record('Demo Era Second')).slug, source: 'A fictional note.', idempotencyKey: key() }, meta)).toMatchObject({ shown: true });
    const edited = await editArchiveLink(archivist.principal, { relationshipId: added.relationshipId, fromYear: null, toYear: null, source: 'A fictional staff note.', certainty: 'disputed', publicSource: null, reason: 'A fictional correction.' }, meta);
    expect(edited.changed).toBe(true);
    const [rel] = await getDb().select({ certainty: teachingRelationship.certainty, publicSource: teachingRelationship.publicSource }).from(teachingRelationship).where(eq(teachingRelationship.id, added.relationshipId));
    expect(rel).toEqual({ certainty: 'disputed', publicSource: null });
    expect(await fields(addArchiveLink(archivist.principal, { lineageId: l.id, teacherSlug: created.slug, studentSlug: student.slug, source: 'x', certainty: 'rumour' as 'documented', idempotencyKey: key() }, meta))).toHaveProperty('certainty');
  });

  it('a record whose life status is unknown stays hidden, and so does the link, until a death is established', async () => {
    const teacher = await record('Demo Unknown Teacher', 'unknown');
    const student = await record('Demo Unknown Student');
    const l = await lineageOf('Demo Archive Lineage Unknown');
    const added = await addArchiveLink(archivist.principal, { lineageId: l.id, teacherSlug: teacher.slug, studentSlug: student.slug, source: 'A fictional letter.', idempotencyKey: key() }, meta);
    expect(added.shown).toBe(false);
    expect(await isPublicPerson(teacher.id)).toBe(false);
    expect(await isPublicEdge(teacher.id, student.id)).toBe(false);
    const periods = await getDb().select({ precision: trainingPeriod.precision, startsOn: trainingPeriod.startsOn }).from(trainingPeriod).where(eq(trainingPeriod.relationshipId, added.relationshipId));
    expect(periods).toEqual([{ precision: 'unknown', startsOn: null }]);
  });

  it('refuses a member’s own record, a cycle, the same person twice, a missing source and years out of range', async () => {
    const a = await record('Demo Cycle Alpha');
    const b = await record('Demo Cycle Beta');
    const l = await lineageOf('Demo Archive Lineage Cycle');
    await addArchiveLink(archivist.principal, { lineageId: l.id, teacherSlug: a.slug, studentSlug: b.slug, source: 'A fictional note.', idempotencyKey: key() }, meta);
    expect(await fields(addArchiveLink(archivist.principal, { lineageId: l.id, teacherSlug: b.slug, studentSlug: a.slug, source: 'A fictional note.', idempotencyKey: key() }, meta))).toEqual({ studentSlug: expect.stringContaining('cycle') });
    const owner = await member('m26-link-member');
    expect(await fields(addArchiveLink(archivist.principal, { lineageId: l.id, teacherSlug: a.slug, studentSlug: owner.slug, source: 'A fictional note.', idempotencyKey: key() }, meta))).toEqual({ studentSlug: expect.stringContaining('member') });
    expect(Object.keys(await fields(addArchiveLink(archivist.principal, { lineageId: l.id, teacherSlug: a.slug, studentSlug: a.slug, fromYear: 1500, toYear: 1400, source: ' ', idempotencyKey: key() }, meta))).sort()).toEqual([
      'fromYear',
      'source',
      'studentSlug',
      'toYear',
    ]);
    expect(await fields(addArchiveLink(archivist.principal, { lineageId: l.id, teacherSlug: a.slug, studentSlug: b.slug, toYear: 1900, source: 'A fictional note.', idempotencyKey: key() }, meta))).toEqual({ fromYear: expect.any(String) });
  });

  it('ends a link entered by mistake: revoked, off the public edges, with its event and reason; never twice', async () => {
    const teacher = await record('Demo End Teacher');
    const student = await record('Demo End Student');
    const l = await lineageOf('Demo Archive Lineage End');
    const added = await addArchiveLink(archivist.principal, { lineageId: l.id, teacherSlug: teacher.slug, studentSlug: student.slug, source: 'A fictional mistake.', idempotencyKey: key() }, meta);
    expect(await fields(endArchiveLink(archivist.principal, { relationshipId: added.relationshipId, reason: ' ', idempotencyKey: key() }, meta))).toEqual({ reason: expect.any(String) });
    const endKey = key();
    await endArchiveLink(admin.principal, { relationshipId: added.relationshipId, reason: 'Entered in the wrong lineage.', idempotencyKey: endKey }, meta);
    expect(await endArchiveLink(admin.principal, { relationshipId: added.relationshipId, reason: 'Entered in the wrong lineage.', idempotencyKey: endKey }, meta)).toEqual({ replayed: true });
    const [rel] = await getDb().select({ status: teachingRelationship.status, isDisplayPrimary: teachingRelationship.isDisplayPrimary }).from(teachingRelationship).where(eq(teachingRelationship.id, added.relationshipId));
    expect(rel).toEqual({ status: 'revoked', isDisplayPrimary: false });
    expect(await isPublicEdge(teacher.id, student.id)).toBe(false);
    expect(await code(endArchiveLink(admin.principal, { relationshipId: added.relationshipId, reason: 'Again.', idempotencyKey: key() }, meta))).toBe('CONFLICT');
    const audits = await getDb().select({ action: auditLog.action, reason: auditLog.reason }).from(auditLog).where(and(eq(auditLog.subjectId, added.relationshipId), eq(auditLog.action, 'relationship.revoke')));
    expect(audits).toEqual([{ action: 'relationship.revoke', reason: 'Entered in the wrong lineage.' }]);
    const view = await getArchiveLineage(archivist.principal, { slug: l.slug });
    expect(view.links).toMatchObject([{ status: 'revoked', shown: false, endable: false }]);
    // The same link may be recorded again in the right form.
    expect(await code(addArchiveLink(archivist.principal, { lineageId: l.id, teacherSlug: teacher.slug, studentSlug: student.slug, source: 'A fictional correction.', idempotencyKey: key() }, meta))).toBe('OK');
  });
});
