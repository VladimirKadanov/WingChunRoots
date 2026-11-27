// The archive editor's working views (archive-grids.ts), against a migrated throwaway database: who
// may read them, the lineage figures (people, generations, sourced share), the people grid (every
// spelling, filters, possible duplicates), the links grid (filters, generation, paging) and the
// outline (only open branches are read) with the side panel. Fictional data only (D20).

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startAuthTestDatabase, stopAuthTestDatabase } from '../auth/test-support';
import { getDb } from '../db';
import type { Principal } from '../auth/principal';
import type { TestDatabase } from '../db/testing';
import { addArchiveLink, createArchiveLineage, createArchiveRecord } from './archive-editor';
import { archiveLinks, archiveOverview, archivePeople, archivePerson, archiveTree } from './archive-grids';
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
  archivist = await staff('grid-archivist', 'archivist');
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

const record = (primaryName: string, extra: Record<string, string> = {}) =>
  createArchiveRecord(archivist.principal, { primaryName, lifeStatus: 'deceased', reason: 'A fictional register.', ...extra }, meta);

async function link(lineageId: string, teacherSlug: string, studentSlug: string, source: string | null = 'A fictional chronicle.', fromYear: number | null = 1900) {
  if (source === null) {
    // A link without a source is only possible from older data: write it, then clear the note.
    const added = await addArchiveLink(archivist.principal, { lineageId, teacherSlug, studentSlug, fromYear, source: 'temporary', idempotencyKey: key() }, meta);
    await getDb().execute(sql`UPDATE teaching_relationship SET source_note = NULL WHERE id = ${added.relationshipId}::uuid`);
    return added;
  }
  return addArchiveLink(archivist.principal, { lineageId, teacherSlug, studentSlug, fromYear, source, idempotencyKey: key() }, meta);
}

describe('archive grids', () => {
  let root: { id: string; slug: string };
  let a: { id: string; slug: string };
  let b: { id: string; slug: string };
  let c: { id: string; slug: string };
  let line: { id: string; slug: string };

  beforeAll(async () => {
    root = await record('Demo Grid Founder', { originalName: '演示網祖', originalLang: 'zh-Hant', jyutping: 'jin2 si6 mong5 zou2' });
    a = await record('Demo Grid Alpha');
    b = await record('Demo Grid Beta');
    c = await record('Demo Grid Gamma');
    line = await createArchiveLineage(archivist.principal, { name: 'Demo Grid Lineage', rootSlug: root.slug, reason: 'A fictional lineage.' }, meta);
    await link(line.id, root.slug, a.slug);
    await link(line.id, root.slug, b.slug, null);
    await link(line.id, a.slug, c.slug, 'A fictional book, page 3.', null);
  });

  it('only an archivist or an administrator with the second factor reads them', async () => {
    const moderator = await staff('grid-moderator', 'moderator');
    const someone = await member('grid-member');
    for (const read of [
      (p: Principal | null) => archiveOverview(p),
      (p: Principal | null) => archivePeople(p),
      (p: Principal | null) => archiveLinks(p, { slug: line.slug }),
      (p: Principal | null) => archiveTree(p, { slug: line.slug }),
      (p: Principal | null) => archivePerson(p, { slug: line.slug, person: root.slug }),
    ]) {
      expect(await code(read(moderator.principal))).toBe('FORBIDDEN');
      expect(await code(read(someone.principal))).toBe('FORBIDDEN');
      expect(await code(read(null))).toBe('UNAUTHORIZED');
      expect(await code(read(archivist.principal))).toBe('OK');
    }
  });

  it('the overview counts people, generations, the sourced share and what needs work', async () => {
    const overview = await archiveOverview(archivist.principal, { q: 'grid lineage' });
    expect(overview.rows).toHaveLength(1);
    expect(overview.rows[0]).toMatchObject({ slug: line.slug, people: 4, links: 3, generations: 3, sourced: 66, needsWork: 2, root: { id: root.id } });
    expect(overview.figures.links).toBeGreaterThanOrEqual(3);
    expect((await archiveOverview(archivist.principal, { q: 'no such lineage zz' })).rows).toEqual([]);
  });

  it('the people grid finds every spelling and filters', async () => {
    for (const q of ['演示網祖', 'jin2 si6 mong5', 'mong zou', 'grid founder', root.slug]) {
      expect((await archivePeople(archivist.principal, { q })).rows.map((r) => r.record.id)).toContain(root.id);
    }
    const inLineage = await archivePeople(archivist.principal, { lineage: line.slug });
    expect(inLineage.rows.map((r) => r.record.id).sort()).toEqual([root.id, a.id, b.id, c.id].sort());
    const founder = inLineage.rows.find((r) => r.record.id === root.id)!;
    expect(founder).toMatchObject({ teachers: 0, students: 2, lineages: [{ slug: line.slug }] });
    const noTeacher = await archivePeople(archivist.principal, { show: 'no_teacher', lineage: line.slug });
    expect(noTeacher.rows.map((r) => r.record.id)).toEqual([root.id]);
    const twin = await record('Demo Grid Alpha');
    const duplicates = await archivePeople(archivist.principal, { show: 'duplicates', q: 'grid alpha' });
    expect(duplicates.rows.map((r) => r.record.id).sort()).toEqual([a.id, twin.id].sort());
    expect(duplicates.rows.every((r) => r.duplicate)).toBe(true);
    expect(duplicates.counts.duplicates).toBeGreaterThanOrEqual(2);
    // Journey review P2-10: the same person entered twice under another Latin spelling is found
    // through the Chinese name (and the Simplified form of it).
    const other = await record('Demo Grid Foundr', { originalName: '演示网祖', originalLang: 'zh-Hans' });
    const byChinese = await archivePeople(archivist.principal, { show: 'duplicates', q: '演示網祖' });
    expect(byChinese.rows.map((r) => r.record.id).sort()).toEqual([root.id, other.id].sort());
    // Each one names only the records it shares a spelling with, not every duplicate on the page.
    expect(byChinese.rows.find((r) => r.record.id === other.id)!.duplicateOf.map((d) => d.slug)).toEqual([root.slug]);
    expect(duplicates.rows.find((r) => r.record.id === twin.id)!.duplicateOf.map((d) => d.slug)).toEqual([a.slug]);
    expect((await archivePeople(archivist.principal, { show: 'duplicates', q: 'grid beta' })).rows).toEqual([]);
    expect((await archivePeople(archivist.principal, { lineage: 'demo-no-such-lineage' })).rows).toEqual([]);
  });

  it('the links grid filters by status, missing source or years, generation and a person, and pages', async () => {
    const all = await archiveLinks(archivist.principal, { slug: line.slug });
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => [r.teacher.id, r.student.id, r.generation])).toEqual([
      [root.id, a.id, 1],
      [root.id, b.id, 1],
      [a.id, c.id, 2],
    ]);
    expect(all.counts).toMatchObject({ active: 3, verified: 3, ended: 0, no_source: 1, no_years: 1 });
    expect(all.generations).toBe(2);
    expect((await archiveLinks(archivist.principal, { slug: line.slug, show: 'no_source' })).rows.map((r) => r.student.id)).toEqual([b.id]);
    expect((await archiveLinks(archivist.principal, { slug: line.slug, show: 'no_years' })).rows.map((r) => r.student.id)).toEqual([c.id]);
    expect((await archiveLinks(archivist.principal, { slug: line.slug, generation: 2 })).rows.map((r) => r.student.id)).toEqual([c.id]);
    expect((await archiveLinks(archivist.principal, { slug: line.slug, q: 'gamma' })).rows.map((r) => r.student.id)).toEqual([c.id]);
    expect((await archiveLinks(archivist.principal, { slug: line.slug, page: 2 })).rows).toEqual([]);
    expect(await code(archiveLinks(archivist.principal, { slug: 'demo-no-such-lineage' }))).toBe('NOT_FOUND');
  });

  it('the outline reads only the open branches; the panel lists teachers and students', async () => {
    const closed = await archiveTree(archivist.principal, { slug: line.slug });
    expect(closed.top.map((n) => [n.record.id, n.students, n.children])).toEqual([[root.id, 2, null]]);
    const open = await archiveTree(archivist.principal, { slug: line.slug, open: [root.slug, a.slug] });
    const top = open.top[0]!;
    expect(top.children!.map((n) => [n.record.id, n.generation, n.students])).toEqual([
      [a.id, 2, 1],
      [b.id, 2, 0],
    ]);
    expect(top.children![0]!.children!.map((n) => n.record.id)).toEqual([c.id]);
    expect(top.children![1]!.children).toBeNull();
    const panel = await archivePerson(archivist.principal, { slug: line.slug, person: a.slug });
    expect(panel).toMatchObject({ generation: 2, teachers: [{ other: { id: root.id } }], students: [{ other: { id: c.id } }], studentsTotal: 1 });
    expect(await code(archivePerson(archivist.principal, { slug: line.slug, person: 'demo-no-such-person' }))).toBe('NOT_FOUND');
  });
});
