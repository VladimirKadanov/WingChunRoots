// The archive editor (milestone M26, docs/adr/0034-archive-editor.md; plan §6.6, §6.7): staff who
// keep the archive create the lineages, the records of historical teachers and the verified links
// between them, each with its source. Before M26 a lineage existed only in the demo data and a
// historical record only through a student's claim (historical.ts), so a clean database could not
// be given its roots.
//
//   archiveEditor.lineages       every lineage, with its root and how many links it has
//   archiveEditor.lineage        one lineage with all its links entered or confirmed
//   archiveEditor.createLineage  a new lineage: a name in Latin letters, a description, a root
//   archiveEditor.updateLineage  rename it, change the description or the root
//   archiveEditor.search         records by any spelling of a name, public or not (for the pickers)
//   archiveEditor.createRecord   a historical record: names in every script, life status, biography
//   archiveEditor.addLink        teacher → student in a lineage, verified on the archivist's source
//   archiveEditor.endLink        end a link entered here by mistake (revoked, with a reason)
//   archiveEditor.editLink       correct a link's years or source in place, with a reason
//
// Who: an archivist or an administrator whose session proved the second factor (ARCHIVE_EDITOR_ROLES;
// the owner's decision for M26, which also opens the archival edit of review.ts to administrators).
//
// The rules a link keeps (the same as a verified historical claim, review.ts):
//   - both ends are records kept by the platform or unclaimed: a member's own links are confirmed by
//     their teacher (M09) or by a claim with evidence (M10a), never entered for them here;
//   - verification_path committee_review, status verified, confirmed by this staff member; the
//     source is required (teaching_relationship.source_note, staff only) and evidence is optional;
//   - the global verify lock, the cycle check and the duplicate check of an approval (plan §6.3);
//   - both people are published where publication.ts allows it: a record whose life status is
//     unknown is treated as living and stays hidden (DEFAULT D03 and the owner's decision of
//     2026-11-14), so the link is public only once both ends are;
//   - relationship_event (null → verified) with the idempotency key, an audit row with the evidence
//     ids, lineage.recompute queued, and the public cache of both people dropped.
//
// Logs and audit rows carry ids, codes and lengths, never a name, a biography or a source text
// (plan §6.4). The reason of a lineage or record change is kept in the audit row, as for the
// archival edit.

import { randomBytes } from 'node:crypto';

import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireStaff2FA } from '../auth/guards';
import type { Principal, StaffRole } from '../auth/principal';
import { EXPLORE_START_TAG, invalidatePublic, lineageTag, personTag } from '../cache';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { evidenceLink, lineage, person, personBio, personName, teachingRelationship, trainingPeriod } from '../db/schema';
import { EVIDENCE_MAX_FILES_PER_CASE, PUBLIC_RELATIONSHIP_STATUSES } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import { enqueue, type Transaction } from '../jobs/outbox';
import { QUEUE } from '../jobs/queues';
import { writePersonKeys } from '../search/store';
import type { RequestMeta } from './context';
import { ARCHIVAL_EVIDENCE_MESSAGE, CLAIM_EVIDENCE_MESSAGE } from './evidence';
import { ServiceError } from './errors';
import { cleanName, isJyutping, isLatinName, isPinyin, matchesScript, NAME_MAX_LENGTH, ORIGINAL_SCRIPTS, originalScript, slugFromName } from './names';
import { BIO_MAX_LENGTH } from './profile';
import { bothPublic } from './publication';
import { closesCycle, CYCLE_MESSAGE, idempotencyKey, isKeyConflict, keyReused, markVerified, publicTags, recordEvent, replayOf, rowById, VERIFY_LOCK, writePeriods } from './relationships';

/** M26 (owner decision): the roles that keep the archive: create, link and edit records. */
export const ARCHIVE_EDITOR_ROLES: readonly StaffRole[] = ['archivist', 'admin'];
export const ARCHIVE_EDITOR_ONLY = 'Only an archivist or an administrator keeps the archive.';

export const LINEAGE_NAME_MAX = 120;
export const LINEAGE_DESCRIPTION_MAX = 2000;
export const SOURCE_MAX = 2000;
export const ARCHIVE_REASON_MAX = 2000;
/** The earliest year of a training period entered here (Wing Chun's recorded history is older than 1900). */
export const ARCHIVE_EARLIEST_YEAR = 1600;
const SEARCH_LIMIT = 20;
const LINKS_LIMIT = 500;

/** editLink on a link that is not the archive's own (see archiveKeepsLink). */
export const MEMBER_LINK_EDIT =
  'This link belongs to a member: it involves a member’s own record or was approved by their teacher. Members’ own links change through their review flow (the member edits the request and their teacher confirms it, or they send a claim with evidence); they are not edited here.';
export const NOT_VERIFIED_EDIT = 'Only a verified link is edited here. A link in arbitration is decided there first, and an ended link keeps its record as it was.';

const MEMBER_LINK = 'This is a member’s own record. Their teachers confirm their links, or they send a claim with evidence; links are not entered for them here.';
const NO_LINEAGE = 'No such lineage.';
const NO_RECORD = 'No record has this address. Use the search, or copy the part after /people/ in the profile’s address.';
const CHECK = 'Check the highlighted fields.';

// --- Input -------------------------------------------------------------------------------------

const text = (max: number) =>
  z
    .string()
    .max(max * 2, { error: `Use at most ${max} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .nullish()
    .transform((s) => (s ? s : null));

const oneLine = (max: number) =>
  z
    .string()
    .max(max * 2, { error: `Use at most ${max} characters.` })
    .transform((s) => cleanName(s))
    .nullish()
    .transform((s) => (s ? s : null));

const slugRef = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .nullish()
  .transform((s) => (s ? s : null));

const year = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => (v === null || v === undefined || v === '' ? null : Number(v)));

function issues(ctx: z.RefinementCtx) {
  return (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
}

function checkReason(reason: string | null, issue: (path: string, message: string) => void) {
  if (!reason) issue('reason', 'Write the reason for this change.');
  else if (reason.length > ARCHIVE_REASON_MAX) issue('reason', `Use at most ${ARCHIVE_REASON_MAX} characters.`);
}

function checkLineageFields(input: { name: string | null; description: string | null }, issue: (path: string, message: string) => void) {
  if (!input.name) issue('name', 'Enter the lineage’s name in Latin letters.');
  else if (input.name.length > LINEAGE_NAME_MAX) issue('name', `Use at most ${LINEAGE_NAME_MAX} characters.`);
  // Latin letters, with the digits and the punctuation a lineage's name may carry ("Line 2", "A & B").
  else if (!isLatinName(input.name.replace(/[0-9(),&]/g, ' ').trim() || input.name)) issue('name', 'Use Latin letters here.');
  if (input.description && input.description.length > LINEAGE_DESCRIPTION_MAX) issue('description', `Use at most ${LINEAGE_DESCRIPTION_MAX} characters.`);
}

export const archiveLineageInput = z.object({ slug: z.string().trim().max(200) });

export const createLineageInput = z
  .object({
    name: oneLine(LINEAGE_NAME_MAX),
    description: text(LINEAGE_DESCRIPTION_MAX),
    /** The address (slug) of the record at the lineage's root; empty when it is not known (DEFAULT D22). */
    rootSlug: slugRef,
    reason: text(ARCHIVE_REASON_MAX),
  })
  .superRefine((input, ctx) => {
    const issue = issues(ctx);
    checkLineageFields(input, issue);
    checkReason(input.reason, issue);
  });
export type CreateLineageInput = z.input<typeof createLineageInput>;

export const updateLineageInput = z
  .object({
    lineageId: z.uuid({ error: NO_LINEAGE }),
    name: oneLine(LINEAGE_NAME_MAX),
    description: text(LINEAGE_DESCRIPTION_MAX),
    rootSlug: slugRef,
    reason: text(ARCHIVE_REASON_MAX),
  })
  .superRefine((input, ctx) => {
    const issue = issues(ctx);
    checkLineageFields(input, issue);
    checkReason(input.reason, issue);
  });
export type UpdateLineageInput = z.input<typeof updateLineageInput>;

export const archiveSearchInput = z.object({ q: z.string().trim().max(200).default('') });

export const createRecordInput = z
  .object({
    primaryName: oneLine(NAME_MAX_LENGTH),
    originalName: oneLine(NAME_MAX_LENGTH),
    originalLang: z
      .string()
      .max(16)
      .nullish()
      .transform((s) => (s ? s : null)),
    jyutping: oneLine(NAME_MAX_LENGTH),
    pinyin: oneLine(NAME_MAX_LENGTH),
    /** Deceased, or not known (treated as living and kept hidden until a death is established). */
    lifeStatus: z.enum(['deceased', 'unknown'], { error: 'Choose whether the person has died or it is not known.' }),
    bio: text(BIO_MAX_LENGTH),
    reason: text(ARCHIVE_REASON_MAX),
    /** Optional: files this staff member uploaded for the record, linked to it. */
    evidenceIds: z.array(z.uuid({ error: ARCHIVAL_EVIDENCE_MESSAGE })).max(EVIDENCE_MAX_FILES_PER_CASE).default([]),
  })
  .superRefine((input, ctx) => {
    const issue = issues(ctx);
    if (!input.primaryName) issue('primaryName', 'Enter the name in Latin letters.');
    else if (input.primaryName.length > NAME_MAX_LENGTH) issue('primaryName', `Use at most ${NAME_MAX_LENGTH} characters.`);
    else if (!isLatinName(input.primaryName)) issue('primaryName', 'Use Latin letters here. Add the name in its own script below.');
    if (input.originalName) {
      const script = input.originalLang ? originalScript(input.originalLang) : undefined;
      if (!script) issue('originalLang', 'Choose the script of this name.');
      else if (input.originalName.length > NAME_MAX_LENGTH) issue('originalName', `Use at most ${NAME_MAX_LENGTH} characters.`);
      else if (!matchesScript(input.originalName, script.lang)) issue('originalName', `This name is not written in ${script.label}.`);
    }
    if (input.jyutping && (input.jyutping.length > NAME_MAX_LENGTH || !isJyutping(input.jyutping))) issue('jyutping', 'Write Jyutping in lower case, with optional tone numbers: sou1 zuk1 cing4.');
    if (input.pinyin && (input.pinyin.length > NAME_MAX_LENGTH || !isPinyin(input.pinyin))) issue('pinyin', 'Write pinyin in Latin letters, with tone marks or tone numbers.');
    if (input.bio && input.bio.length > BIO_MAX_LENGTH) issue('bio', `Use at most ${BIO_MAX_LENGTH} characters.`);
    checkReason(input.reason, issue);
  });
export type CreateRecordInput = z.input<typeof createRecordInput>;

export const addLinkInput = z
  .object({
    lineageId: z.uuid({ error: 'Choose the lineage.' }),
    teacherSlug: slugRef,
    studentSlug: slugRef,
    /** The years of the training, when known; both empty: the dates are not known. */
    fromYear: year,
    toYear: year,
    /** Required: where the link comes from (a book and page, an interview, a certificate). Staff only. */
    source: text(SOURCE_MAX),
    evidenceIds: z.array(z.uuid({ error: ARCHIVAL_EVIDENCE_MESSAGE })).max(EVIDENCE_MAX_FILES_PER_CASE).default([]),
    idempotencyKey,
  })
  .superRefine((input, ctx) => {
    const issue = issues(ctx);
    if (!input.teacherSlug) issue('teacherSlug', 'Choose the teacher.');
    if (!input.studentSlug) issue('studentSlug', 'Choose the student.');
    if (input.teacherSlug && input.teacherSlug === input.studentSlug) issue('studentSlug', 'A person can’t be their own teacher.');
    checkYearsAndSource(input, issue);
  });
export type AddLinkInput = z.input<typeof addLinkInput>;

/** The years and the source of a link, as addLink and editLink take them. */
function checkYearsAndSource(input: { fromYear: number | null; toYear: number | null; source: string | null }, issue: (path: string, message: string) => void) {
  const thisYear = new Date().getUTCFullYear();
  for (const [field, value] of [
    ['fromYear', input.fromYear],
    ['toYear', input.toYear],
  ] as const) {
    if (value === null) continue;
    if (!Number.isInteger(value) || value < ARCHIVE_EARLIEST_YEAR || value > thisYear) issue(field, `Write a year from ${ARCHIVE_EARLIEST_YEAR} to ${thisYear}, or leave it empty.`);
  }
  if (input.fromYear === null && input.toYear !== null) issue('fromYear', 'Give the year the training started, or leave both years empty.');
  if (input.fromYear !== null && input.toYear !== null && input.toYear < input.fromYear) issue('toYear', 'The end can’t be before the start.');
  if (!input.source) issue('source', 'Write the source: where this training is recorded.');
  else if (input.source.length > SOURCE_MAX) issue('source', `Use at most ${SOURCE_MAX} characters.`);
}

export const editLinkInput = z
  .object({
    relationshipId: z.uuid({ error: 'Choose a link.' }),
    /** The years of the training, when known; both empty: the dates are not known. */
    fromYear: year,
    toYear: year,
    /** Required, as for a new link. Staff only. */
    source: text(SOURCE_MAX),
    reason: text(ARCHIVE_REASON_MAX),
  })
  .superRefine((input, ctx) => {
    const issue = issues(ctx);
    checkYearsAndSource(input, issue);
    checkReason(input.reason, issue);
  });
export type EditLinkInput = z.input<typeof editLinkInput>;

export const endLinkInput = z
  .object({
    relationshipId: z.uuid({ error: 'Choose a link.' }),
    reason: text(ARCHIVE_REASON_MAX),
    idempotencyKey,
  })
  .superRefine((input, ctx) => checkReason(input.reason, issues(ctx)));
export type EndLinkInput = z.input<typeof endLinkInput>;

// --- Views -------------------------------------------------------------------------------------

export interface ArchiveRecordRef {
  id: string;
  slug: string;
  name: { value: string; lang: string };
  original: { value: string; lang: string } | null;
  kind: 'living' | 'historical';
  lifeStatus: 'living' | 'deceased' | 'unknown';
  stewardship: 'self' | 'platform' | 'unclaimed';
  /** Shown on the public pages now (public and not taken down). */
  shown: boolean;
}

export interface ArchiveLineageSummary {
  id: string;
  slug: string;
  name: string;
  root: ArchiveRecordRef | null;
  /** Links verified or in arbitration. */
  links: number;
  /** Whether the explorer offers it now (a public root with a public link, explore-start.ts). */
  listed: boolean;
}

export interface ArchiveLinkView {
  id: string;
  teacher: ArchiveRecordRef;
  student: ArchiveRecordRef;
  status: 'verified' | 'in_arbitration' | 'revoked';
  /** Public now: verified or in arbitration, and both ends shown. */
  shown: boolean;
  fromYear: number | null;
  toYear: number | null;
  source: string | null;
  /** How it was established: entered or confirmed by staff, or approved by the teacher. */
  path: 'committee_review' | 'teacher_approval';
  /** This staff member may end it here (a verified link between two records kept by the platform). */
  endable: boolean;
}

/**
 * Whether the archive editor may end or edit a link: verified, established by staff, and neither end
 * a member's own record. Any other link changes through its own flow (the member's request and their
 * teacher's approval, a claim with evidence, or arbitration).
 */
export function archiveKeepsLink(link: { status: string; path: string; teacher: { stewardship: string }; student: { stewardship: string } }): boolean {
  return link.status === 'verified' && link.path === 'committee_review' && link.teacher.stewardship !== 'self' && link.student.stewardship !== 'self';
}

export interface ArchiveLineageView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  root: ArchiveRecordRef | null;
  listed: boolean;
  links: ArchiveLinkView[];
}

export interface ArchiveEditorOptions {
  scripts: { lang: string; label: string }[];
  earliestYear: number;
}

/** The scripts of the name forms and the earliest year, for the pages. */
export function archiveEditorOptions(): ArchiveEditorOptions {
  return { scripts: ORIGINAL_SCRIPTS.map((s) => ({ lang: s.lang, label: s.label })), earliestYear: ARCHIVE_EARLIEST_YEAR };
}

// --- Helpers -----------------------------------------------------------------------------------

function editor(principal: Principal | null) {
  const p = requireStaff2FA(principal);
  if (!(ARCHIVE_EDITOR_ROLES as readonly string[]).includes(p.user.role)) throw new ServiceError('FORBIDDEN', ARCHIVE_EDITOR_ONLY);
  return p;
}

/** The same guard for the archive grids service (archive-grids.ts). */
export function requireArchiveEditor(principal: Principal | null) {
  return editor(principal);
}

function fieldErrors(error: z.ZodError): ServiceError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
  return new ServiceError('BAD_REQUEST', CHECK, fields);
}

export async function refsOf(db: Executor, ids: readonly string[]): Promise<Map<string, ArchiveRecordRef>> {
  const out = new Map<string, ArchiveRecordRef>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const people = await db
    .select({
      id: person.id,
      slug: person.slug,
      kind: person.kind,
      lifeStatus: person.lifeStatus,
      stewardship: person.stewardship,
      visibility: person.visibility,
      takenDownAt: person.takenDownAt,
    })
    .from(person)
    .where(and(inArray(person.id, unique), isNull(person.deletedAt)));
  if (people.length === 0) return out;
  const names = await db
    .select({ personId: personName.personId, value: personName.value, lang: personName.lang, kind: personName.kind, isPrimary: personName.isPrimary })
    .from(personName)
    .where(inArray(personName.personId, people.map((p) => p.id)))
    .orderBy(asc(personName.sortOrder), asc(personName.id));
  for (const p of people) {
    const own = names.filter((n) => n.personId === p.id);
    const primary = own.find((n) => n.isPrimary);
    const original = own.find((n) => !n.isPrimary && n.kind === 'name');
    out.set(p.id, {
      id: p.id,
      slug: p.slug,
      name: primary ? { value: primary.value, lang: primary.lang } : { value: p.slug, lang: 'und-Latn' },
      original: original ? { value: original.value, lang: original.lang } : null,
      kind: p.kind,
      lifeStatus: p.lifeStatus,
      stewardship: p.stewardship,
      shown: p.visibility === 'public' && p.takenDownAt === null,
    });
  }
  return out;
}

async function recordBySlug(db: Executor, slug: string, lock = false) {
  const query = db
    .select({ id: person.id, slug: person.slug, stewardship: person.stewardship })
    .from(person)
    .where(and(eq(person.slug, slug), isNull(person.deletedAt)));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

/** Whether the explorer offers the lineage (explore-start.ts): a public root with a public link. */
export async function listedLineages(db: Executor, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const result = await db.execute<{ id: string }>(sql`
    SELECT DISTINCT e.lineage_id::text AS id FROM v_public_edge e
      JOIN v_public_person p ON p.id = e.lineage_root_person_id
     WHERE e.lineage_id IN (${sql.join(
       ids.map((id) => sql`${id}::uuid`),
       sql`, `,
     )})`);
  return new Set(result.rows.map((r) => r.id));
}

/** A lineage slug from its name: lowercase ASCII words, with a number when the name is taken. */
async function lineageSlug(db: Executor, name: string): Promise<string> {
  const base = slugFromName(name, 'x').replace(/-x$/, '').slice(0, 60).replace(/-+$/g, '') || 'lineage';
  const taken = new Set(
    (await db.select({ slug: lineage.slug }).from(lineage).where(or(eq(lineage.slug, base), ilike(lineage.slug, `${base}-%`)))).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${randomBytes(4).toString('hex')}`;
}

async function nameTaken(db: Executor, name: string, except?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: lineage.id })
    .from(lineage)
    .where(and(sql`lower(${lineage.name}) = lower(${name})`, isNull(lineage.deletedAt), except ? ne(lineage.id, except) : undefined));
  return Boolean(row);
}

/** The root of a lineage form: a record that exists and is not a member's own. Field error or id. */
async function rootOf(db: Executor, slug: string | null): Promise<{ id: string | null; error: string | null }> {
  if (!slug) return { id: null, error: null };
  const record = await recordBySlug(db, slug);
  if (!record) return { id: null, error: NO_RECORD };
  if (record.stewardship === 'self') return { id: null, error: 'A member’s own record is not set as a lineage’s root here. Choose a record kept by the platform.' };
  return { id: record.id, error: null };
}

/** Links the given files (the staff member's own uploads, not part of a claim) to a record or a link. */
async function linkFiles(tx: Transaction, p: Principal, subject: { personId: string } | { relationshipId: string }, fileIds: readonly string[], note: string): Promise<string | null> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return null;
  const own = await tx.execute<{ id: string }>(sql`
    SELECT f.id::text AS id FROM evidence_file f
     WHERE f.id IN (${sql.join(
       ids.map((id) => sql`${id}::uuid`),
       sql`, `,
     )}) AND f.uploaded_by_user_id = ${p.user.id}::uuid AND f.deleted_at IS NULL
     FOR UPDATE`);
  if (own.rows.length !== ids.length) return ARCHIVAL_EVIDENCE_MESSAGE;
  const claimed = await tx.execute<{ id: string }>(sql`
    SELECT l.id::text AS id FROM evidence_link l
     WHERE l.evidence_file_id IN (${sql.join(
       ids.map((id) => sql`${id}::uuid`),
       sql`, `,
     )}) AND l.review_case_id IS NOT NULL LIMIT 1`);
  if (claimed.rows.length > 0) return CLAIM_EVIDENCE_MESSAGE;
  await tx.insert(evidenceLink).values(ids.map((id) => ({ evidenceFileId: id, ...subject, createdByUserId: p.user.id, note })));
  return null;
}

const yearOf = (d: string | null) => (d ? Number(d.slice(0, 4)) : null);

// --- Reads -------------------------------------------------------------------------------------

/** archiveEditor.lineages: every lineage, by name. */
export async function listArchiveLineages(principal: Principal | null): Promise<{ lineages: ArchiveLineageSummary[]; options: ArchiveEditorOptions }> {
  editor(principal);
  const db = getDb();
  const rows = await db
    .select({
      id: lineage.id,
      slug: lineage.slug,
      name: lineage.name,
      rootPersonId: lineage.rootPersonId,
      links: sql<number>`(SELECT count(*)::int FROM teaching_relationship r WHERE r.lineage_id = lineage.id AND r.status IN ('verified', 'in_arbitration'))`,
    })
    .from(lineage)
    .where(isNull(lineage.deletedAt))
    .orderBy(asc(sql`lower(${lineage.name})`), asc(lineage.id))
    .limit(500);
  const refs = await refsOf(db, rows.map((r) => r.rootPersonId).filter((id): id is string => id !== null));
  const listed = await listedLineages(db, rows.map((r) => r.id));
  return {
    lineages: rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, root: r.rootPersonId ? (refs.get(r.rootPersonId) ?? null) : null, links: r.links, listed: listed.has(r.id) })),
    options: archiveEditorOptions(),
  };
}

/** archiveEditor.lineage: one lineage with its links (established and ended), oldest first. */
export async function getArchiveLineage(principal: Principal | null, raw: z.input<typeof archiveLineageInput>): Promise<ArchiveLineageView & { options: ArchiveEditorOptions }> {
  editor(principal);
  const parsed = archiveLineageInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('NOT_FOUND', NO_LINEAGE);
  const db = getDb();
  const [row] = await db
    .select({ id: lineage.id, slug: lineage.slug, name: lineage.name, description: lineage.description, rootPersonId: lineage.rootPersonId })
    .from(lineage)
    .where(and(eq(lineage.slug, parsed.data.slug), isNull(lineage.deletedAt)));
  if (!row) throw new ServiceError('NOT_FOUND', NO_LINEAGE);
  const links = await db
    .select({
      id: teachingRelationship.id,
      teacher: teachingRelationship.teacherPersonId,
      student: teachingRelationship.studentPersonId,
      status: teachingRelationship.status,
      path: teachingRelationship.verificationPath,
      source: teachingRelationship.sourceNote,
      startsOn: sql<string | null>`(SELECT min(tp.starts_on)::text FROM training_period tp WHERE tp.relationship_id = teaching_relationship.id)`,
      endsOn: sql<string | null>`(SELECT max(tp.ends_on)::text FROM training_period tp WHERE tp.relationship_id = teaching_relationship.id)`,
    })
    .from(teachingRelationship)
    .where(and(eq(teachingRelationship.lineageId, row.id), inArray(teachingRelationship.status, ['verified', 'in_arbitration', 'revoked'])))
    .orderBy(asc(teachingRelationship.createdAt), asc(teachingRelationship.id))
    .limit(LINKS_LIMIT);
  const refs = await refsOf(db, [...links.flatMap((l) => [l.teacher, l.student]), ...(row.rootPersonId ? [row.rootPersonId] : [])]);
  const listed = await listedLineages(db, [row.id]);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    root: row.rootPersonId ? (refs.get(row.rootPersonId) ?? null) : null,
    listed: listed.has(row.id),
    links: links
      .filter((l) => refs.has(l.teacher) && refs.has(l.student))
      .map((l) => {
        const teacher = refs.get(l.teacher)!;
        const student = refs.get(l.student)!;
        const status = l.status as ArchiveLinkView['status'];
        return {
          id: l.id,
          teacher,
          student,
          status,
          shown: status !== 'revoked' && teacher.shown && student.shown,
          fromYear: yearOf(l.startsOn),
          toYear: yearOf(l.endsOn),
          source: l.source,
          path: l.path,
          endable: archiveKeepsLink({ status, path: l.path, teacher, student }),
        };
      }),
    options: archiveEditorOptions(),
  };
}

/** archiveEditor.search: records by any spelling of a name, or by their address; public or not. */
export async function searchArchiveRecords(principal: Principal | null, raw: z.input<typeof archiveSearchInput>): Promise<{ records: ArchiveRecordRef[] }> {
  editor(principal);
  const parsed = archiveSearchInput.safeParse(raw);
  const q = parsed.success ? cleanName(parsed.data.q) : '';
  if (q.length < 2) return { records: [] };
  const db = getDb();
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .selectDistinct({ id: person.id, slug: person.slug })
    .from(person)
    .leftJoin(personName, eq(personName.personId, person.id))
    .where(and(isNull(person.deletedAt), or(ilike(personName.value, pattern), eq(person.slug, q.toLowerCase()))))
    .orderBy(asc(person.slug))
    .limit(SEARCH_LIMIT);
  const refs = await refsOf(db, rows.map((r) => r.id));
  return { records: rows.map((r) => refs.get(r.id)).filter((r): r is ArchiveRecordRef => Boolean(r)) };
}

// --- Lineages ----------------------------------------------------------------------------------

/** archiveEditor.createLineage: a new lineage (not shown anywhere until it has a public link). */
export async function createArchiveLineage(principal: Principal | null, raw: CreateLineageInput, meta: RequestMeta): Promise<{ id: string; slug: string }> {
  const p = editor(principal);
  const parsed = createLineageInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  return getDb().transaction(async (tx) => {
    // One lineage created at a time, so two forms sent at once cannot take the same name or slug.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('lineage.create'))`);
    const root = await rootOf(tx, input.rootSlug);
    const fields: Record<string, string> = {};
    if (root.error) fields.rootSlug = root.error;
    if (await nameTaken(tx, input.name!)) fields.name = 'A lineage with this name exists already. Open it from the list.';
    if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', CHECK, fields);
    const id = uuidv7();
    const slug = await lineageSlug(tx, input.name!);
    await tx.insert(lineage).values({ id, slug, name: input.name!, description: input.description, rootPersonId: root.id });
    await writeAudit(tx, {
      action: 'lineage.create',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'lineage',
      subjectId: id,
      after: { slug, rootPersonId: root.id, description: input.description ? { length: input.description.length } : null },
      reason: input.reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { id, slug };
  });
}

/** archiveEditor.updateLineage: the name, the description and the root. Nothing changed: nothing written. */
export async function updateArchiveLineage(principal: Principal | null, raw: UpdateLineageInput, meta: RequestMeta): Promise<{ slug: string; changed: boolean }> {
  const p = editor(principal);
  const parsed = updateLineageInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const outcome = await getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('lineage.create'))`);
    const [row] = await tx
      .select({ id: lineage.id, slug: lineage.slug, name: lineage.name, description: lineage.description, rootPersonId: lineage.rootPersonId })
      .from(lineage)
      .where(and(eq(lineage.id, input.lineageId), isNull(lineage.deletedAt)))
      .for('update');
    if (!row) throw new ServiceError('NOT_FOUND', NO_LINEAGE);
    const root = await rootOf(tx, input.rootSlug);
    const fields: Record<string, string> = {};
    if (root.error) fields.rootSlug = root.error;
    if (await nameTaken(tx, input.name!, row.id)) fields.name = 'Another lineage has this name.';
    if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', CHECK, fields);
    const changed = { name: row.name !== input.name, description: row.description !== input.description, root: row.rootPersonId !== root.id };
    if (!changed.name && !changed.description && !changed.root) return { slug: row.slug, changed: false, tags: [] as string[] };
    await tx.update(lineage).set({ name: input.name!, description: input.description, rootPersonId: root.id, updatedAt: new Date() }).where(eq(lineage.id, row.id));
    await writeAudit(tx, {
      action: 'lineage.update',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'lineage',
      subjectId: row.id,
      before: { rootPersonId: row.rootPersonId },
      after: { changed, rootPersonId: root.id, description: input.description ? { length: input.description.length } : null },
      reason: input.reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    // The depth below the root and the explorer's list of lineages follow the root (lineage_membership).
    if (changed.root) await enqueue(tx, QUEUE.lineageRecompute, { lineageIds: [row.id] });
    const tags = [lineageTag(row.id), EXPLORE_START_TAG];
    if (row.rootPersonId) tags.push(personTag(row.rootPersonId), lineageTag(row.rootPersonId));
    if (root.id) tags.push(personTag(root.id), lineageTag(root.id));
    if (changed.name) {
      // Every profile that names the lineage on one of its links.
      const members = await tx
        .select({ t: teachingRelationship.teacherPersonId, s: teachingRelationship.studentPersonId })
        .from(teachingRelationship)
        .where(and(eq(teachingRelationship.lineageId, row.id), inArray(teachingRelationship.status, [...PUBLIC_RELATIONSHIP_STATUSES])))
        .limit(5000);
      for (const m of members) tags.push(personTag(m.t), personTag(m.s));
    }
    return { slug: row.slug, changed: true, tags: [...new Set(tags)] };
  });
  if (outcome.tags.length > 0) invalidatePublic(outcome.tags, 'procedure');
  return { slug: outcome.slug, changed: outcome.changed };
}

// --- Records -----------------------------------------------------------------------------------

/**
 * archiveEditor.createRecord: a historical record kept by the platform, private until one of its
 * links is verified (DEFAULT D03). Names in Latin letters (required), in their own script, Jyutping
 * and pinyin; the search keys are written for every spelling (M07).
 */
export async function createArchiveRecord(principal: Principal | null, raw: CreateRecordInput, meta: RequestMeta): Promise<{ id: string; slug: string }> {
  const p = editor(principal);
  const parsed = createRecordInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  return getDb().transaction(async (tx) => {
    const id = uuidv7();
    const slug = slugFromName(input.primaryName!, randomBytes(4).toString('hex'));
    // DEFAULT D03: involved_only until a link is verified; publication.ts decides then.
    await tx.insert(person).values({ id, slug, kind: 'historical', lifeStatus: input.lifeStatus, stewardship: 'platform', visibility: 'involved_only', createdByUserId: p.user.id });
    const script = input.originalName && input.originalLang ? originalScript(input.originalLang)! : null;
    const names: (typeof personName.$inferInsert)[] = [{ personId: id, kind: 'name', value: input.primaryName!, script: 'Latn', lang: 'und-Latn', isPrimary: true, sortOrder: 0 }];
    if (script && input.originalName) names.push({ personId: id, kind: 'name', value: input.originalName, script: script.script, lang: script.lang, sortOrder: 1 });
    if (input.jyutping) names.push({ personId: id, kind: 'romanization', value: input.jyutping.toLowerCase(), script: 'Latn', lang: 'yue-Latn', romanization: 'jyutping', sortOrder: 2 });
    if (input.pinyin) names.push({ personId: id, kind: 'romanization', value: input.pinyin, script: 'Latn', lang: 'zh-Latn-pinyin', romanization: 'pinyin', sortOrder: 3 });
    await tx.insert(personName).values(names);
    if (input.bio) await tx.insert(personBio).values({ personId: id, lang: 'en', body: input.bio });
    const keys = await writePersonKeys(tx, id);
    const evidenceError = await linkFiles(tx, p, { personId: id }, input.evidenceIds, 'archive editor: record');
    if (evidenceError) throw new ServiceError('BAD_REQUEST', CHECK, { evidenceIds: evidenceError });
    await writeAudit(tx, {
      action: 'person.create',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'person',
      subjectId: id,
      after: {
        archiveEditor: true,
        kind: 'historical',
        lifeStatus: input.lifeStatus,
        stewardship: 'platform',
        visibility: 'involved_only',
        names: names.map((n) => ({ kind: n.kind, script: n.script, lang: n.lang })),
        bio: input.bio ? { lang: 'en', length: input.bio.length } : null,
        searchKeys: keys,
        evidence_ids: [...new Set(input.evidenceIds)],
      },
      reason: input.reason,
      evidenceIds: input.evidenceIds,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { id, slug };
  });
}

// --- Links -------------------------------------------------------------------------------------

/**
 * archiveEditor.addLink: teacher → student in a lineage, verified on the staff member's source (see
 * the top of this file). A second call with the same key returns the first link and writes nothing.
 */
export async function addArchiveLink(principal: Principal | null, raw: AddLinkInput, meta: RequestMeta): Promise<{ relationshipId: string; shown: boolean; replayed: boolean }> {
  const p = editor(principal);
  const parsed = addLinkInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  try {
    const outcome = await db.transaction(async (tx) => {
      // One verification at a time, everywhere (plan §6.3), as for an approval or a verified claim.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${VERIFY_LOCK}))`);
      const replay = await replayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        if (replay.fromStatus !== null || replay.toStatus !== 'verified' || replay.reason !== 'archive') throw keyReused();
        return { id: replay.relationshipId, shown: false, replayed: true, tags: [] as string[] };
      }
      const [line] = await tx.select({ id: lineage.id }).from(lineage).where(and(eq(lineage.id, input.lineageId), isNull(lineage.deletedAt)));
      const teacher = await recordBySlug(tx, input.teacherSlug!, true);
      const student = await recordBySlug(tx, input.studentSlug!, true);
      const fields: Record<string, string> = {};
      if (!line) fields.lineageId = 'Choose the lineage.';
      if (!teacher) fields.teacherSlug = NO_RECORD;
      else if (teacher.stewardship === 'self') fields.teacherSlug = MEMBER_LINK;
      if (!student) fields.studentSlug = NO_RECORD;
      else if (student.stewardship === 'self') fields.studentSlug = MEMBER_LINK;
      if (Object.keys(fields).length > 0 || !teacher || !student || !line) throw new ServiceError('BAD_REQUEST', CHECK, fields);
      if (teacher.id === student.id) throw new ServiceError('BAD_REQUEST', CHECK, { studentSlug: 'A person can’t be their own teacher.' });
      const [duplicate] = await tx
        .select({ id: teachingRelationship.id })
        .from(teachingRelationship)
        .where(
          and(
            eq(teachingRelationship.teacherPersonId, teacher.id),
            eq(teachingRelationship.studentPersonId, student.id),
            eq(teachingRelationship.lineageId, line.id),
            inArray(teachingRelationship.status, ['pending_teacher', 'awaiting_claim', 'under_review', 'verified', 'in_arbitration']),
          ),
        );
      if (duplicate) throw new ServiceError('CONFLICT', 'This link is already recorded in this lineage.', { studentSlug: 'This link is already recorded in this lineage.' });
      if (await closesCycle(tx, teacher.id, student.id)) throw new ServiceError('CONFLICT', CYCLE_MESSAGE, { studentSlug: CYCLE_MESSAGE });

      const id = uuidv7();
      await tx.insert(teachingRelationship).values({
        id,
        teacherPersonId: teacher.id,
        studentPersonId: student.id,
        lineageId: line.id,
        status: 'under_review',
        visibility: 'involved_only',
        verificationPath: 'committee_review',
        requestedByUserId: p.user.id,
        sourceNote: input.source,
      });
      const fromYear = input.fromYear;
      const toYear = input.toYear;
      await tx.insert(trainingPeriod).values(
        fromYear === null
          ? { relationshipId: id, precision: 'unknown', sortOrder: 0 }
          : { relationshipId: id, startsOn: `${fromYear}-01-01`, endsOn: toYear === null ? null : `${toYear}-01-01`, precision: 'year', ongoing: false, sortOrder: 0 },
      );
      const evidenceError = await linkFiles(tx, p, { relationshipId: id }, input.evidenceIds, 'archive editor: link');
      if (evidenceError) throw new ServiceError('BAD_REQUEST', CHECK, { evidenceIds: evidenceError });
      const row = await rowById(tx, id, true);
      if (!row) throw new ServiceError('CONFLICT', 'The link could not be saved. Try again.');
      const now = new Date();
      const verified = await markVerified(tx, row, p.user.id, now);
      const shown = await bothPublic(tx, teacher.id, student.id);
      await recordEvent(tx, { relationshipId: id, from: null, to: 'verified', actor: p, role: p.user.role, reason: 'archive', key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'relationship.verify',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: id,
        after: {
          archiveEditor: true,
          status: 'verified',
          verificationPath: 'committee_review',
          teacherPersonId: teacher.id,
          studentPersonId: student.id,
          lineageId: line.id,
          years: { from: fromYear, to: toYear },
          source: { length: input.source!.length },
          ...verified,
          shown,
          evidence_ids: [...new Set(input.evidenceIds)],
        },
        evidenceIds: input.evidenceIds,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      // The derived lineage_membership, from the worker (plan §6.3, §6.4), as for an approval.
      await enqueue(tx, QUEUE.lineageRecompute, { lineageIds: [line.id] });
      return { id, shown, replayed: false, tags: [...(await publicTags(tx, row)), lineageTag(line.id), EXPLORE_START_TAG] };
    });
    if (outcome.tags.length > 0) invalidatePublic(outcome.tags, 'procedure');
    return { relationshipId: outcome.id, shown: outcome.shown, replayed: outcome.replayed };
  } catch (error) {
    if (isKeyConflict(error)) throw keyReused();
    throw error;
  }
}

/**
 * archiveEditor.endLink: a link entered in the archive by mistake is ended (revoked, with the
 * reason), never deleted (plan §6.7: relationships end). Only a verified link between two records
 * kept by the platform or unclaimed, established by staff; any other link is disputed through
 * arbitration (M10b).
 */
export async function endArchiveLink(principal: Principal | null, raw: EndLinkInput, meta: RequestMeta): Promise<{ replayed: boolean }> {
  const p = editor(principal);
  const parsed = endLinkInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  try {
    const outcome = await db.transaction(async (tx) => {
      const row = await rowById(tx, input.relationshipId, true);
      if (!row) throw new ServiceError('NOT_FOUND', 'No such link.');
      const replay = await replayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        if (replay.relationshipId !== row.id || replay.toStatus !== 'revoked') throw keyReused();
        return { replayed: true, tags: [] as string[] };
      }
      const ends = await tx
        .select({ id: person.id, stewardship: person.stewardship })
        .from(person)
        .where(inArray(person.id, [row.teacherPersonId, row.studentPersonId]));
      if (row.status !== 'verified' || row.verificationPath !== 'committee_review' || ends.some((e) => e.stewardship === 'self')) {
        throw new ServiceError('CONFLICT', 'Only a verified link between two records kept by the platform is ended here. Set any other link in arbitration from the record’s page.');
      }
      const now = new Date();
      await tx
        .update(teachingRelationship)
        .set({ status: 'revoked', isDisplayPrimary: false, statusReason: 'archive', updatedAt: now })
        .where(eq(teachingRelationship.id, row.id));
      await recordEvent(tx, { relationshipId: row.id, from: 'verified', to: 'revoked', actor: p, role: p.user.role, reason: 'archive', key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'relationship.revoke',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: row.id,
        before: { status: 'verified', isDisplayPrimary: row.isDisplayPrimary },
        after: { archiveEditor: true, status: 'revoked', lineageId: row.lineageId },
        reason: input.reason,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await enqueue(tx, QUEUE.lineageRecompute, { lineageIds: [row.lineageId] });
      return { replayed: false, tags: [...(await publicTags(tx, row)), lineageTag(row.lineageId), EXPLORE_START_TAG] };
    });
    if (outcome.tags.length > 0) invalidatePublic(outcome.tags, 'procedure');
    return { replayed: outcome.replayed };
  } catch (error) {
    if (isKeyConflict(error)) throw keyReused();
    throw error;
  }
}

/**
 * archiveEditor.editLink: the years or the source of a link the archive keeps (archiveKeepsLink),
 * corrected in place with a reason instead of ending the link and adding it again. The status, the
 * confirmation and the history stay; no relationship_event is written, since those record changes
 * of status. Changed years replace the link's training periods with one period in years (keeping
 * the school of the first one); unchanged years leave the periods as they are. Nothing changed:
 * nothing written. A member's link is refused (MEMBER_LINK_EDIT), never edited silently.
 */
export async function editArchiveLink(principal: Principal | null, raw: EditLinkInput, meta: RequestMeta): Promise<{ changed: boolean }> {
  const p = requireArchiveEditor(principal);
  const parsed = editLinkInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const outcome = await getDb().transaction(async (tx) => {
    const row = await rowById(tx, input.relationshipId, true);
    if (!row) throw new ServiceError('NOT_FOUND', 'No such link.');
    const ends = await tx
      .select({ id: person.id, stewardship: person.stewardship })
      .from(person)
      .where(inArray(person.id, [row.teacherPersonId, row.studentPersonId]));
    const stewardship = (id: string) => ends.find((e) => e.id === id)?.stewardship ?? 'self';
    const link = { status: row.status, path: row.verificationPath, teacher: { stewardship: stewardship(row.teacherPersonId) }, student: { stewardship: stewardship(row.studentPersonId) } };
    if (link.path !== 'committee_review' || link.teacher.stewardship === 'self' || link.student.stewardship === 'self') throw new ServiceError('CONFLICT', MEMBER_LINK_EDIT);
    if (!archiveKeepsLink(link)) throw new ServiceError('CONFLICT', NOT_VERIFIED_EDIT);
    const [{ sourceNote } = { sourceNote: null }] = await tx.select({ sourceNote: teachingRelationship.sourceNote }).from(teachingRelationship).where(eq(teachingRelationship.id, row.id));

    const periods = await tx
      .select({ startsOn: trainingPeriod.startsOn, endsOn: trainingPeriod.endsOn, schoolId: trainingPeriod.schoolId })
      .from(trainingPeriod)
      .where(eq(trainingPeriod.relationshipId, row.id))
      .orderBy(asc(trainingPeriod.sortOrder), asc(trainingPeriod.id));
    const starts = periods.map((x) => x.startsOn).filter((d): d is string => d !== null).sort();
    const endsOn = periods.map((x) => x.endsOn).filter((d): d is string => d !== null).sort();
    const before = { from: yearOf(starts[0] ?? null), to: yearOf(endsOn.at(-1) ?? null) };
    const after = { from: input.fromYear, to: input.toYear };
    const changed = { years: before.from !== after.from || before.to !== after.to, source: sourceNote !== input.source };
    if (!changed.years && !changed.source) return { changed: false, tags: [] as string[] };

    const now = new Date();
    if (changed.years) {
      const schoolId = periods.find((x) => x.schoolId !== null)?.schoolId ?? null;
      await writePeriods(tx, row.id, [
        after.from === null
          ? { startsOn: null, endsOn: null, precision: 'unknown', ongoing: false, schoolId, sortOrder: 0 }
          : { startsOn: `${after.from}-01-01`, endsOn: after.to === null ? null : `${after.to}-01-01`, precision: 'year', ongoing: false, schoolId, sortOrder: 0 },
      ]);
    }
    await tx.update(teachingRelationship).set({ sourceNote: input.source, updatedAt: now }).where(eq(teachingRelationship.id, row.id));
    await writeAudit(tx, {
      action: 'relationship.edit',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'teaching_relationship',
      subjectId: row.id,
      before: { years: before, periods: periods.length, source: sourceNote ? { length: sourceNote.length } : null },
      after: { archiveEditor: true, status: row.status, lineageId: row.lineageId, changed, years: after, source: { length: input.source!.length } },
      reason: input.reason,
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    // The years show on the public profiles and in the lineage's outline; the source is staff only,
    // but the same tags as addLink and endLink are dropped so every view reads the link afresh.
    return { changed: true, tags: [...(await publicTags(tx, row)), lineageTag(row.lineageId), EXPLORE_START_TAG] };
  });
  if (outcome.tags.length > 0) invalidatePublic(outcome.tags, 'procedure');
  return { changed: outcome.changed };
}
