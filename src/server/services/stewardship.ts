// Historical stewardship (milestone M25, In scope 3; specification §5.3, §16.1, §16.3;
// docs/adr/0028-governance.md). A record kept by the platform or unclaimed (a historical master, a
// teacher who has not joined) is a shared archival record: no school, organization or member edits
// it alone. Anyone signed in may propose a change, with a reason (and evidence for a life status);
// an archivist approves it (the change is applied) or rejects it, with a reason. Every change of
// such a record, by the archival edit (review.ts archive.update) or an approved proposal, is a row
// of record_revision, its change history (append-only). An organizational split never touches
// these records: organizations hold no right over any archival record.
//
//   archive.history   the change history of a public shared record: when, what changed and how
//                     (public); staff with the second factor also read the reason
//   records.proposeOptions / records.propose
//                     the form and the proposal (a review_case of kind record_proposal)
//
// Logs and audit rows carry ids and the names of the fields, never a name or a biography.

import { and, asc, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { hasStaff2FA, requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { person, personBio, personName, recordProposal, recordRevision, type RecordFields, reviewCase, reviewNote } from '../db/schema';
import { GOVERNANCE_DAILY_LIMIT, GOVERNANCE_TEXT_MAX } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import type { Transaction } from '../jobs/outbox';
import { writePersonKeys } from '../search/store';
import type { RequestMeta } from './context';
import { linkOptionalFilesToCase } from './evidence';
import { pgErrorOf, ServiceError } from './errors';
import { cleanName, isLatinName, matchesScript, NAME_MAX_LENGTH, ORIGINAL_SCRIPTS, originalScript } from './names';
import { BIO_MAX_LENGTH } from './profile';
import { idempotencyKey, keyReused } from './relationships';
import { caseReplayOf, isCaseKeyConflict, lockAccountCases, recordCaseEvent, tellStaff } from './review-core';

export const RECORD_FIELD_LABELS: Record<keyof RecordFields, string> = {
  primaryName: 'Name',
  originalName: 'Name in its own script',
  originalLang: 'Script of the name',
  lifeStatus: 'Life status',
  bio: 'Biography',
};
const LIFE_LABELS = { living: 'Living', deceased: 'Deceased', unknown: 'Unknown' } as const;

const NO_RECORD = 'No such record.';
const noRecord = () => new ServiceError('NOT_FOUND', NO_RECORD);
const NOT_SHARED = 'This record is kept by its owner: they correct it themselves. Shared archival records are the ones kept by the archive or unclaimed.';

// --- The fields of a record ----------------------------------------------------------------------

export interface RecordState {
  id: string;
  slug: string;
  kind: string;
  stewardship: 'self' | 'platform' | 'unclaimed';
  visibility: 'public' | 'involved_only';
  fields: RecordFields;
  names: { id: string; kind: string; value: string; lang: string; isPrimary: boolean; sortOrder: number }[];
  primaryId: string | null;
  originalId: string | null;
  bioId: string | null;
}

/** A live record and its editable fields, locked FOR UPDATE when `lock`. */
export async function recordState(db: Executor, where: { id: string } | { slug: string }, lock = false): Promise<RecordState | null> {
  const query = db
    .select({ id: person.id, slug: person.slug, kind: person.kind, lifeStatus: person.lifeStatus, stewardship: person.stewardship, visibility: person.visibility })
    .from(person)
    .where(and('id' in where ? eq(person.id, where.id) : eq(person.slug, where.slug), isNull(person.deletedAt)));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) return null;
  const names = await db
    .select({ id: personName.id, kind: personName.kind, value: personName.value, lang: personName.lang, isPrimary: personName.isPrimary, sortOrder: personName.sortOrder })
    .from(personName)
    .where(eq(personName.personId, row.id))
    .orderBy(asc(personName.sortOrder), asc(personName.id));
  const [bio] = await db.select({ id: personBio.id, body: personBio.body }).from(personBio).where(and(eq(personBio.personId, row.id), eq(personBio.lang, 'en')));
  const primary = names.find((n) => n.isPrimary) ?? null;
  const original = names.find((n) => !n.isPrimary && n.kind === 'name') ?? null;
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    stewardship: row.stewardship,
    visibility: row.visibility,
    fields: { primaryName: primary?.value ?? '', originalName: original?.value ?? null, originalLang: original?.lang ?? null, lifeStatus: row.lifeStatus, bio: bio?.body ?? null },
    names,
    primaryId: primary?.id ?? null,
    originalId: original?.id ?? null,
    bioId: bio?.id ?? null,
  };
}

/** The fields that differ between two versions of a record. */
export function changedFields(before: RecordFields, after: RecordFields): (keyof RecordFields)[] {
  const out: (keyof RecordFields)[] = [];
  if (before.primaryName !== after.primaryName) out.push('primaryName');
  if (before.originalName !== after.originalName || (after.originalName !== null && before.originalLang !== after.originalLang)) out.push('originalName');
  if (before.lifeStatus !== after.lifeStatus) out.push('lifeStatus');
  if (before.bio !== after.bio) out.push('bio');
  return out;
}

/**
 * Writes `next` over the record (names, life status, English biography) in the caller's
 * transaction, which holds the record FOR UPDATE; returns what changed and the search keys
 * written. The archival edit and an approved proposal share it.
 */
export async function writeRecordFields(tx: Transaction, state: RecordState, next: RecordFields): Promise<{ changed: (keyof RecordFields)[]; searchKeys: number | null }> {
  const changed = changedFields(state.fields, next);
  if (changed.length === 0) return { changed, searchKeys: null };
  const now = new Date();
  const script = next.originalName && next.originalLang ? originalScript(next.originalLang)! : null;
  if (changed.includes('primaryName')) {
    if (state.primaryId) await tx.update(personName).set({ value: next.primaryName, updatedAt: now }).where(eq(personName.id, state.primaryId));
    else await tx.insert(personName).values({ personId: state.id, kind: 'name', value: next.primaryName, script: 'Latn', lang: 'und-Latn', isPrimary: true, sortOrder: 0 });
  }
  if (changed.includes('originalName')) {
    if (state.originalId && script && next.originalName) {
      await tx.update(personName).set({ value: next.originalName, script: script.script, lang: script.lang, updatedAt: now }).where(eq(personName.id, state.originalId));
    } else if (state.originalId) {
      await tx.delete(personName).where(eq(personName.id, state.originalId));
    } else if (script && next.originalName) {
      await tx.insert(personName).values({ personId: state.id, kind: 'name', value: next.originalName, script: script.script, lang: script.lang, sortOrder: Math.max(1, ...state.names.map((n) => n.sortOrder + 1)) });
    }
  }
  const searchKeys = changed.includes('primaryName') || changed.includes('originalName') ? await writePersonKeys(tx, state.id) : null;
  if (changed.includes('lifeStatus')) await tx.update(person).set({ lifeStatus: next.lifeStatus, updatedAt: now }).where(eq(person.id, state.id));
  if (changed.includes('bio')) {
    if (state.bioId && next.bio) await tx.update(personBio).set({ body: next.bio, updatedAt: now }).where(eq(personBio.id, state.bioId));
    else if (state.bioId) await tx.delete(personBio).where(eq(personBio.id, state.bioId));
    else if (next.bio) await tx.insert(personBio).values({ personId: state.id, lang: 'en', body: next.bio });
  }
  await tx.update(person).set({ updatedAt: now }).where(eq(person.id, state.id));
  return { changed, searchKeys };
}

/** One row of the record's change history (append-only). */
export async function recordRevisionRow(
  tx: Transaction,
  row: { personId: string; source: 'archival_edit' | 'proposal'; actorUserId: string; reviewCaseId: string | null; changed: readonly string[]; before: RecordFields; after: RecordFields; reason: string },
): Promise<string> {
  const id = uuidv7();
  await tx.insert(recordRevision).values({ id, ...row, changed: [...row.changed] });
  return id;
}

// --- Input ---------------------------------------------------------------------------------------

const optionalName = z
  .string()
  .max(NAME_MAX_LENGTH * 2)
  .transform((s) => cleanName(s))
  .nullish()
  .transform((s) => (s ? s : null));

export const recordSlugInput = z.object({ slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/, { error: NO_RECORD }) });

export const proposeInput = z
  .object({
    personId: z.uuid({ error: NO_RECORD }),
    primaryName: z
      .string({ error: 'Enter the name in Latin letters.' })
      .max(NAME_MAX_LENGTH * 2)
      .transform((s) => cleanName(s)),
    originalName: optionalName,
    originalLang: z
      .string()
      .max(16)
      .nullish()
      .transform((s) => (s ? s : null)),
    lifeStatus: z.enum(['living', 'deceased', 'unknown'], { error: 'Choose a life status.' }),
    bio: z
      .string()
      .max(BIO_MAX_LENGTH * 2)
      .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
      .nullish()
      .transform((s) => (s ? s : null)),
    reason: z
      .string({ error: 'Write why the record should change.' })
      .max(GOVERNANCE_TEXT_MAX * 2)
      .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim()),
    evidenceIds: z.array(z.uuid({ error: 'Some of these files are no longer available.' })).max(20).default([]),
    idempotencyKey,
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (!input.primaryName) issue('primaryName', 'Enter the name in Latin letters.');
    else if (input.primaryName.length > NAME_MAX_LENGTH) issue('primaryName', `Use at most ${NAME_MAX_LENGTH} characters.`);
    else if (!isLatinName(input.primaryName)) issue('primaryName', 'Use Latin letters here. Add the name in its own script below.');
    if (input.originalName) {
      const script = input.originalLang ? originalScript(input.originalLang) : undefined;
      if (!script) issue('originalLang', 'Choose the script of this name.');
      else if (input.originalName.length > NAME_MAX_LENGTH) issue('originalName', `Use at most ${NAME_MAX_LENGTH} characters.`);
      else if (!matchesScript(input.originalName, script.lang)) issue('originalName', `This name is not written in ${script.label}.`);
    }
    if (input.bio && input.bio.length > BIO_MAX_LENGTH) issue('bio', `Use at most ${BIO_MAX_LENGTH} characters.`);
    if (!input.reason) issue('reason', 'Write why the record should change.');
    else if (input.reason.length > GOVERNANCE_TEXT_MAX) issue('reason', `Use at most ${GOVERNANCE_TEXT_MAX} characters.`);
  });

function fieldsOf(input: z.output<typeof proposeInput>): RecordFields {
  return { primaryName: input.primaryName, originalName: input.originalName, originalLang: input.originalName ? input.originalLang : null, lifeStatus: input.lifeStatus, bio: input.bio };
}

const isShared = (s: RecordState) => s.stewardship !== 'self' && s.visibility === 'public';

// --- archive.history -------------------------------------------------------------------------------

export interface RecordHistory {
  slug: string;
  revisions: { id: string; createdAt: string; source: 'archival_edit' | 'proposal'; sourceLabel: string; changed: string[]; reason: string | null }[];
}

/**
 * archive.history: the change history of a shared record that is public (anyone), or of any record
 * (staff with the second factor, who also read each reason). Never who made a change.
 */
export async function recordHistory(principal: Principal | null, raw: z.input<typeof recordSlugInput>): Promise<RecordHistory> {
  const parsed = recordSlugInput.safeParse(raw);
  if (!parsed.success) throw noRecord();
  const db = getDb();
  const state = await recordState(db, { slug: parsed.data.slug });
  const staff = hasStaff2FA(principal);
  if (!state || (!staff && !isShared(state))) throw noRecord();
  const rows = await db
    .select({ id: recordRevision.id, createdAt: recordRevision.createdAt, source: recordRevision.source, changed: recordRevision.changed, reason: recordRevision.reason })
    .from(recordRevision)
    .where(eq(recordRevision.personId, state.id))
    .orderBy(desc(recordRevision.createdAt), desc(recordRevision.id))
    .limit(100);
  return {
    slug: state.slug,
    revisions: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      source: r.source,
      sourceLabel: r.source === 'proposal' ? 'Approved proposal' : 'Archival edit',
      changed: r.changed.map((c) => RECORD_FIELD_LABELS[c as keyof RecordFields] ?? c),
      reason: staff ? r.reason : null,
    })),
  };
}

// --- records.proposeOptions / records.propose ---------------------------------------------------------

export interface ProposeOptions {
  personId: string;
  slug: string;
  fields: RecordFields;
  scripts: { lang: string; label: string }[];
  /** This account's proposal for the record that waits for review, if any. */
  pendingCaseId: string | null;
}

/** records.proposeOptions: the current fields of a public shared record, for the proposal form. */
export async function proposeOptions(principal: Principal | null, raw: z.input<typeof recordSlugInput>): Promise<ProposeOptions> {
  const p = requireUser(principal);
  const parsed = recordSlugInput.safeParse(raw);
  if (!parsed.success) throw noRecord();
  const db = getDb();
  const state = await recordState(db, { slug: parsed.data.slug });
  if (!state || state.visibility !== 'public') throw noRecord();
  if (state.stewardship === 'self') throw new ServiceError('FORBIDDEN', NOT_SHARED);
  const [pending] = await db
    .select({ caseId: recordProposal.reviewCaseId })
    .from(recordProposal)
    .where(and(eq(recordProposal.personId, state.id), eq(recordProposal.proposerUserId, p.user.id), eq(recordProposal.status, 'pending')));
  return { personId: state.id, slug: state.slug, fields: state.fields, scripts: ORIGINAL_SCRIPTS.map((s) => ({ lang: s.lang, label: s.label })), pendingCaseId: pending?.caseId ?? null };
}

/**
 * records.propose: a signed-in account proposes a change to a public shared record (see the top).
 * Nothing changes until an archivist approves it. DEFAULT M25 (question 7): a proposed change of the
 * life status needs at least one file of evidence; at most GOVERNANCE_DAILY_LIMIT proposals a day.
 */
export async function proposeRecordChange(principal: Principal | null, raw: z.input<typeof proposeInput>, meta: RequestMeta): Promise<{ caseId: string; replayed: boolean }> {
  const p = requireUser(principal);
  const parsed = proposeInput.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
    throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
  }
  const input = parsed.data;
  const next = fieldsOf(input);
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      await lockAccountCases(tx, p.user.id);
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        if (replay.action !== 'open') throw keyReused();
        return { caseId: replay.caseId, replayed: true };
      }
      const state = await recordState(tx, { id: input.personId });
      if (!state || state.visibility !== 'public') throw noRecord();
      if (state.stewardship === 'self') throw new ServiceError('FORBIDDEN', NOT_SHARED);
      const changed = changedFields(state.fields, next);
      if (changed.length === 0) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { form: 'Change at least one field: the record already says this.' });
      if (changed.includes('lifeStatus') && input.evidenceIds.length === 0) {
        throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { evidenceIds: 'A change of the life status needs at least one file of evidence.' });
      }
      const [{ n: today } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(recordProposal)
        .where(and(eq(recordProposal.proposerUserId, p.user.id), gt(recordProposal.createdAt, sql`now() - interval '24 hours'`)));
      if (today >= GOVERNANCE_DAILY_LIMIT) throw new ServiceError('TOO_MANY_REQUESTS', 'You have proposed several changes today. You can propose more tomorrow.');
      const caseId = uuidv7();
      await tx.insert(reviewCase).values({ id: caseId, kind: 'record_proposal', status: 'open', personId: state.id, openedByUserId: p.user.id });
      const evidenceError = await linkOptionalFilesToCase(tx, p.user.id, caseId, input.evidenceIds);
      if (evidenceError) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { evidenceIds: evidenceError });
      await tx.insert(reviewNote).values({ reviewCaseId: caseId, authorUserId: p.user.id, body: input.reason, isInternal: false });
      await tx.insert(recordProposal).values({ personId: state.id, proposerUserId: p.user.id, reviewCaseId: caseId, proposed: next, base: state.fields, status: 'pending' });
      await recordCaseEvent(tx, { caseId, action: 'open', from: null, to: 'open', actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'record.propose',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'person',
        subjectId: state.id,
        after: { caseId, changed, stewardship: state.stewardship },
        evidenceIds: input.evidenceIds,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellStaff(tx, caseId, 'record_proposal', [p.user.id]);
      return { caseId, replayed: false };
    });
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'record_proposal_one_pending_key') throw new ServiceError('CONFLICT', 'Your earlier proposal for this record waits for review. You can send more once it is decided.');
    throw error;
  }
}

/** For the proposal's case card (review.ts): each changed field, as it is now and as proposed. */
export async function proposalFacts(db: Executor, caseId: string): Promise<{ label: string; value: string }[] | null> {
  const [row] = await db.select({ proposed: recordProposal.proposed, base: recordProposal.base, status: recordProposal.status, personId: recordProposal.personId }).from(recordProposal).where(eq(recordProposal.reviewCaseId, caseId));
  if (!row) return null;
  const show = (f: keyof RecordFields, v: RecordFields) => {
    const value = f === 'lifeStatus' ? LIFE_LABELS[v.lifeStatus] : f === 'originalName' ? (v.originalName ? `${v.originalName} (${v.originalLang})` : null) : v[f];
    return value ?? '(none)';
  };
  const state = await recordState(db, { id: row.personId });
  const out: { label: string; value: string }[] = [];
  for (const f of changedFields(row.base, row.proposed)) out.push({ label: RECORD_FIELD_LABELS[f], value: `When proposed: ${show(f, row.base)} → Proposed: ${show(f, row.proposed)}` });
  if (state && row.status === 'pending' && changedFields(row.base, state.fields).some((f) => changedFields(row.base, row.proposed).includes(f))) {
    out.push({ label: 'Since the proposal', value: 'The record changed in a field this proposal changes: approving it is refused. Reject it with a reason, or ask for a new proposal.' });
  }
  out.push({ label: 'Record', value: state?.stewardship === 'unclaimed' ? 'Unclaimed record, shared' : 'Kept by the archive, shared' });
  return out;
}
