// Journey review P2-10 (docs/adr/0086-archive-duplicates.md): the same teacher entered twice is
// merged into one record by staff who keep the archive (archivist, or administrator with the second
// factor), instead of being kept twice or deleted by hand.
//
//   archiveEditor.mergeRecord  move one record's links, names and evidence onto the kept record,
//                              leave its address redirecting there, and remove it (deleted_at)
//
// The rules:
//   - both are records the archive keeps (stewardship platform or unclaimed, no account): a member's
//     own record takes links only from their teacher or a claim (archive-editor.ts), never here;
//   - the two are not linked to each other (end that link first: a person can't teach themselves);
//   - the merged record has nothing but names, links, a biography, evidence and its history. Any other
//     tie (an event, a passport, a school, a claim, an invitation, a follow, an organization) refuses
//     the merge, found from the catalog so a new table is never moved silently;
//   - its links move to the kept record. A link the kept record already has (same other person, same
//     lineage) is ended instead (revoked, reason 'merge'), with its history. The cycle check runs on
//     the result (plan §6.3) and the global verify lock is held, as for any verified link;
//   - its names become other spellings of the kept record (the primary one an alias), except the ones
//     it already has; the search keys of both are written again (M07);
//   - a lineage rooted on it is rooted on the kept record; the lineages are recomputed (worker);
//   - person_redirect keeps the old address, and older addresses that pointed at it follow;
//   - an audit row with ids and counts only (plan §6.4), never a name.

import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import type { Principal } from '../auth/principal';
import { EXPLORE_START_TAG, invalidatePublic, lineageTag, personTag } from '../cache';
import { getDb } from '../db';
import { evidenceLink, lineage, lineageMembership, person, personName, personRedirect, teachingRelationship } from '../db/schema';
import { ACTIVE_RELATIONSHIP_STATUSES, PUBLIC_RELATIONSHIP_STATUSES } from '../db/schema/common';
import { enqueue } from '../jobs/outbox';
import { QUEUE } from '../jobs/queues';
import { writePersonKeys } from '../search/store';
import { ARCHIVE_REASON_MAX, requireArchiveEditor } from './archive-editor';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { CYCLE_MESSAGE, publicTags, recordEvent, VERIFY_LOCK } from './relationships';

const CHECK = 'Check the highlighted fields.';
const NO_RECORD = 'No record has this address. Use the search, or copy the part after /people/ in the profile’s address.';
export const MERGE_MEMBER = 'This is a member’s own record. A member’s record is never merged here; their links come from their teachers or a claim.';
export const MERGE_SAME = 'Choose another record to keep: this is the same one.';
export const MERGE_LINKED = 'These two records are linked to each other. End that link first, then merge.';
export const MERGE_OTHER_TIES =
  'This record has more than names, links and evidence (an event, a passport, a school, a claim, an invitation, a follow or an organization). Only a record with names, links and evidence is merged.';
export const MERGE_PENDING = 'This record has a link that is still waiting (a request or a claim). Decide it first, then merge.';

/** The tables a merge handles itself; every other reference to person refuses it. */
const HANDLED = new Set([
  'teaching_relationship',
  'person_name',
  'person_name_key',
  'person_bio',
  'evidence_link',
  'lineage',
  'lineage_membership',
  'person_redirect',
  // History of the record itself: it stays with the removed record.
  'record_revision',
  'review_case',
]);

const slugRef = z.string().trim().max(200);

export const mergeRecordInput = z.object({
  fromSlug: slugRef,
  intoSlug: slugRef,
  reason: z.string().trim().max(ARCHIVE_REASON_MAX),
});
export type MergeRecordInput = z.input<typeof mergeRecordInput>;

export interface MergeRecordResult {
  slug: string;
  movedLinks: number;
  endedLinks: number;
  movedNames: number;
}

/** archiveEditor.mergeRecord: see the top of this file. */
export async function mergeArchiveRecord(principal: Principal | null, raw: MergeRecordInput, meta: RequestMeta): Promise<MergeRecordResult> {
  const p = requireArchiveEditor(principal);
  const parsed = mergeRecordInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', CHECK, { form: CHECK });
  const input = parsed.data;
  const fields: Record<string, string> = {};
  if (!input.fromSlug) fields.fromSlug = NO_RECORD;
  if (!input.intoSlug) fields.intoSlug = 'Give the address of the record to keep.';
  if (!input.reason) fields.reason = 'Write the reason for this change.';
  if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', CHECK, fields);

  const outcome = await getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${VERIFY_LOCK}))`);
    const found = await tx
      .select({ id: person.id, slug: person.slug, stewardship: person.stewardship, claimedByUserId: person.claimedByUserId })
      .from(person)
      .where(and(inArray(person.slug, [input.fromSlug, input.intoSlug]), isNull(person.deletedAt)))
      .orderBy(person.id)
      .for('update');
    const from = found.find((r) => r.slug === input.fromSlug);
    const into = found.find((r) => r.slug === input.intoSlug);
    if (!from) fields.fromSlug = NO_RECORD;
    else if (from.stewardship === 'self' || from.claimedByUserId) fields.fromSlug = MERGE_MEMBER;
    if (!into) fields.intoSlug = NO_RECORD;
    else if (into.stewardship === 'self' || into.claimedByUserId) fields.intoSlug = MERGE_MEMBER;
    if (Object.keys(fields).length > 0 || !from || !into) throw new ServiceError('BAD_REQUEST', CHECK, fields);
    if (from.id === into.id) throw new ServiceError('BAD_REQUEST', CHECK, { intoSlug: MERGE_SAME });

    // Every other table that points at the record, from the catalog.
    const refs = await tx.execute<{ table_name: string; column_name: string }>(sql`
      SELECT c.conrelid::regclass::text AS table_name, a.attname::text AS column_name
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.contype = 'f' AND c.confrelid = 'person'::regclass
       ORDER BY 1, 2`);
    for (const ref of refs.rows) {
      if (HANDLED.has(ref.table_name.replace(/^public\./, '').replace(/"/g, ''))) continue;
      const tied = await tx.execute(sql`SELECT 1 FROM ${sql.identifier(ref.table_name.replace(/"/g, ''))} WHERE ${sql.identifier(ref.column_name)} = ${from.id}::uuid LIMIT 1`);
      if (tied.rows.length > 0) throw new ServiceError('CONFLICT', MERGE_OTHER_TIES, { fromSlug: MERGE_OTHER_TIES });
    }

    const links = await tx
      .select({
        id: teachingRelationship.id,
        teacherPersonId: teachingRelationship.teacherPersonId,
        studentPersonId: teachingRelationship.studentPersonId,
        lineageId: teachingRelationship.lineageId,
        status: teachingRelationship.status,
        isDisplayPrimary: teachingRelationship.isDisplayPrimary,
      })
      .from(teachingRelationship)
      .where(or(eq(teachingRelationship.teacherPersonId, from.id), eq(teachingRelationship.studentPersonId, from.id)))
      .for('update');
    const active = (s: string) => (ACTIVE_RELATIONSHIP_STATUSES as readonly string[]).includes(s);
    const established = (s: string) => (PUBLIC_RELATIONSHIP_STATUSES as readonly string[]).includes(s);
    if (links.some((l) => active(l.status) && !established(l.status))) throw new ServiceError('CONFLICT', MERGE_PENDING, { fromSlug: MERGE_PENDING });
    if (links.some((l) => l.teacherPersonId === into.id || l.studentPersonId === into.id)) {
      throw new ServiceError('CONFLICT', MERGE_LINKED, { intoSlug: MERGE_LINKED });
    }
    const intoLinks = await tx
      .select({ teacherPersonId: teachingRelationship.teacherPersonId, studentPersonId: teachingRelationship.studentPersonId, lineageId: teachingRelationship.lineageId, isDisplayPrimary: teachingRelationship.isDisplayPrimary, status: teachingRelationship.status })
      .from(teachingRelationship)
      .where(and(or(eq(teachingRelationship.teacherPersonId, into.id), eq(teachingRelationship.studentPersonId, into.id)), inArray(teachingRelationship.status, [...ACTIVE_RELATIONSHIP_STATUSES])));
    const pairKey = (t: string, s: string, l: string) => `${t}|${s}|${l}`;
    const kept = new Set(intoLinks.map((l) => pairKey(l.teacherPersonId, l.studentPersonId, l.lineageId)));
    let hasPrimary = intoLinks.some((l) => l.studentPersonId === into.id && l.isDisplayPrimary && established(l.status));
    const tags = new Set<string>([personTag(from.id), personTag(into.id), lineageTag(from.id), lineageTag(into.id), EXPLORE_START_TAG]);
    const lineageIds = new Set<string>();
    let movedLinks = 0;
    let endedLinks = 0;
    const now = new Date();
    for (const l of links) {
      for (const tag of await publicTags(tx, l)) tags.add(tag);
      lineageIds.add(l.lineageId);
      const teacherId = l.teacherPersonId === from.id ? into.id : l.teacherPersonId;
      const studentId = l.studentPersonId === from.id ? into.id : l.studentPersonId;
      const key = pairKey(teacherId, studentId, l.lineageId);
      if (active(l.status) && kept.has(key)) {
        // The kept record has this link already: this copy ends, with its history.
        await tx.update(teachingRelationship).set({ status: 'revoked', isDisplayPrimary: false, statusReason: 'merge', updatedAt: now }).where(eq(teachingRelationship.id, l.id));
        await recordEvent(tx, { relationshipId: l.id, from: l.status as 'verified', to: 'revoked', actor: p, role: p.user.role, reason: 'merge', key: null });
        endedLinks += 1;
        continue;
      }
      // One display-primary teacher per student (DEFAULT D05): the kept record's own choice stays.
      let isDisplayPrimary = l.isDisplayPrimary;
      if (l.studentPersonId === from.id) {
        isDisplayPrimary = l.isDisplayPrimary && established(l.status) && !hasPrimary;
        if (isDisplayPrimary) hasPrimary = true;
      }
      await tx.update(teachingRelationship).set({ teacherPersonId: teacherId, studentPersonId: studentId, isDisplayPrimary, updatedAt: now }).where(eq(teachingRelationship.id, l.id));
      if (active(l.status)) kept.add(key);
      movedLinks += 1;
    }
    // The cycle check on the result (plan §6.3): the kept record never reaches itself.
    const cycle = await tx.execute<{ cycle: boolean }>(sql`
      WITH RECURSIVE up(id) AS (
        SELECT tr.teacher_person_id FROM teaching_relationship tr WHERE tr.student_person_id = ${into.id}::uuid AND tr.status IN ('verified', 'in_arbitration')
        UNION
        SELECT tr.teacher_person_id FROM up JOIN teaching_relationship tr ON tr.student_person_id = up.id WHERE tr.status IN ('verified', 'in_arbitration')
      )
      SELECT EXISTS (SELECT 1 FROM (SELECT id FROM up LIMIT 10000) a WHERE a.id = ${into.id}::uuid) AS cycle`);
    if (cycle.rows[0]?.cycle) throw new ServiceError('CONFLICT', CYCLE_MESSAGE, { intoSlug: CYCLE_MESSAGE });

    // Names: other spellings of the kept record, unless it has them already.
    const names = await tx.select().from(personName).where(inArray(personName.personId, [from.id, into.id]));
    const own = new Set(names.filter((n) => n.personId === into.id).map((n) => `${n.lang}|${n.value.trim().toLowerCase()}`));
    let order = Math.max(0, ...names.filter((n) => n.personId === into.id).map((n) => n.sortOrder)) + 1;
    let movedNames = 0;
    // The kept record's own script stays its original name; any other becomes another spelling.
    let hasOriginal = names.some((n) => n.personId === into.id && !n.isPrimary && n.kind === 'name');
    for (const n of names.filter((x) => x.personId === from.id)) {
      const k = `${n.lang}|${n.value.trim().toLowerCase()}`;
      if (own.has(k)) continue;
      own.add(k);
      const original = n.kind === 'name' && n.script !== 'Latn' && !hasOriginal;
      if (original) hasOriginal = true;
      await tx
        .update(personName)
        .set({ personId: into.id, isPrimary: false, kind: n.kind === 'name' && !original ? 'alias' : n.kind, sortOrder: order, updatedAt: now })
        .where(eq(personName.id, n.id));
      order += 1;
      movedNames += 1;
    }
    const keys = await writePersonKeys(tx, into.id);
    await writePersonKeys(tx, from.id);

    const evidence = await tx.update(evidenceLink).set({ personId: into.id }).where(eq(evidenceLink.personId, from.id)).returning({ id: evidenceLink.id });
    const rooted = await tx.update(lineage).set({ rootPersonId: into.id, updatedAt: now }).where(eq(lineage.rootPersonId, from.id)).returning({ id: lineage.id });
    for (const r of rooted) lineageIds.add(r.id);
    await tx.delete(lineageMembership).where(eq(lineageMembership.personId, from.id));
    await tx.update(personRedirect).set({ personId: into.id }).where(eq(personRedirect.personId, from.id));
    await tx.insert(personRedirect).values({ fromSlug: from.slug, personId: into.id }).onConflictDoUpdate({ target: personRedirect.fromSlug, set: { personId: into.id } });
    await tx.update(person).set({ deletedAt: now, updatedAt: now }).where(eq(person.id, from.id));
    for (const id of lineageIds) tags.add(lineageTag(id));

    await writeAudit(tx, {
      action: 'person.merge',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'person',
      subjectId: from.id,
      after: { archiveEditor: true, intoPersonId: into.id, movedLinks, endedLinks, movedNames, evidence: evidence.length, rootedLineages: rooted.length, searchKeys: keys },
      reason: input.reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    if (lineageIds.size > 0) await enqueue(tx, QUEUE.lineageRecompute, { lineageIds: [...lineageIds] });
    return { slug: into.slug, movedLinks, endedLinks, movedNames, tags: [...tags] };
  });
  invalidatePublic(outcome.tags, 'procedure');
  return { slug: outcome.slug, movedLinks: outcome.movedLinks, endedLinks: outcome.endedLinks, movedNames: outcome.movedNames };
}
