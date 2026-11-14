// A staff take-down of a profile, and its restore (review 2026-11; docs/adr/0030-takedown-suspension-erasure.md).
//
// Until now only a profile's own owner could hide it, and an unclaimed, archive-kept or historical
// record could not be hidden at all, so a report that staff upheld changed nothing on the public
// pages. A moderator or an administrator (staff role and a current second factor) can now take any
// person record off every public surface, with a reason, and put it back.
//
// How: the record is set to `involved_only` and the hold columns (person.taken_down_at, _reason,
// _visibility) are filled in the same update. Every public surface already reads only the public
// people (the v_public_* views, search, the lineage and its counters, photos, schools, events,
// organizations), so nothing else changes. The CHECK person_taken_down_hidden makes it impossible
// for any other code path to publish a held record: the owner's own "show publicly" box records the
// owner's choice for later (setOwnVisibility), and an approval that would publish both ends of a link
// leaves it hidden (relationships.ts markVerified). It is not `deleted_at`: that means "removed" and
// the owner, the staff and the people at the other end of a link still open the record.
//
// DEFAULT review-2026-11 (docs/plan/questions/review-2026-11-takedown.md): a take-down is a reversible hold that
// stays visible to the people involved (option 1), not a deletion and not a hiding from the owner.
//
// A restore returns the record to what it was, unless the owner changed their mind in the meantime:
// a self-stewarded record whose owner withdrew the publication consent stays private (DEFAULT D03).
//
// Audit rows carry ids, the visibility before and after and the case; the reason is the staff
// member's own words and is also what the owner reads in the notice (never the name of a reporter).

import { and, eq, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireStaff2FA } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { EVENTS_TAG, invalidatePublic, ORGANIZATIONS_TAG, SCHOOLS_TAG } from '../cache';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { consentRecord, person, reviewCase, reviewNote } from '../db/schema';
import type { Transaction } from '../jobs/outbox';
import { queueRecomputeForPerson } from './lineage-membership';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { notify } from './notify';
import { neighbourTags } from './profile';

export const TAKEDOWN_REASON_MAX = 500;
/** Who takes a profile down and restores it: a moderator or an administrator, with a verified second factor. */
export const TAKEDOWN_ROLES = ['moderator', 'admin'] as const;

const reasonText = (message: string) =>
  z
    .string({ error: message })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().min(1, { error: message }).max(TAKEDOWN_REASON_MAX, { error: `Use at most ${TAKEDOWN_REASON_MAX} characters.` }));

export const takeDownInput = z.object({
  personId: z.uuid({ error: 'No such record.' }),
  // The owner reads this reason; it never names a reporter.
  reason: reasonText('Write the reason the owner will read.'),
  /** The review case this comes from, when it does: the take-down is recorded on it. */
  caseId: z.uuid({ error: 'No such case.' }).nullish().transform((v) => v ?? null),
});
export type TakeDownInput = z.input<typeof takeDownInput>;

export const restoreInput = z.object({
  personId: z.uuid({ error: 'No such record.' }),
  reason: reasonText('Write why the record is put back.'),
  caseId: z.uuid({ error: 'No such case.' }).nullish().transform((v) => v ?? null),
});
export type RestoreInput = z.input<typeof restoreInput>;

export interface TakedownResult {
  personId: string;
  slug: string;
  /** Whether the record is held after the call. */
  takenDown: boolean;
  /** The record's visibility after the call. */
  visibility: 'public' | 'involved_only';
  /** False when the record was in the requested state already: nothing was written. */
  changed: boolean;
}

interface Held {
  id: string;
  slug: string;
  visibility: 'public' | 'involved_only';
  stewardship: 'self' | 'platform' | 'unclaimed';
  claimedByUserId: string | null;
  takenDownAt: Date | null;
  takenDownVisibility: 'public' | 'involved_only' | null;
}

async function lockPerson(tx: Transaction, personId: string): Promise<Held> {
  const [row] = await tx
    .select({
      id: person.id,
      slug: person.slug,
      visibility: person.visibility,
      stewardship: person.stewardship,
      claimedByUserId: person.claimedByUserId,
      takenDownAt: person.takenDownAt,
      takenDownVisibility: person.takenDownVisibility,
    })
    .from(person)
    // A removed record (deleted_at) is not a profile anyone can see: nothing to take down.
    .where(and(eq(person.id, personId), sql`${person.deletedAt} IS NULL`))
    .for('update');
  if (!row) throw new ServiceError('NOT_FOUND', 'No such record.');
  return row;
}

/**
 * The case the call is recorded on, locked first: the decision of a case takes the case before the
 * person, so a take-down on the same case takes them in the same order.
 */
async function checkCase(tx: Transaction, caseId: string, personId: string): Promise<void> {
  const [c] = await tx.select({ personId: reviewCase.personId }).from(reviewCase).where(eq(reviewCase.id, caseId)).for('update');
  if (!c) throw new ServiceError('NOT_FOUND', 'No such case.');
  if (c.personId !== personId) throw new ServiceError('BAD_REQUEST', 'That case is not about this record.');
}

/** The publication choice of a self-stewarded owner, as the consent log has it (DEFAULT D03). */
async function ownerWithdrewPublication(tx: Transaction, row: Held): Promise<boolean> {
  if (row.stewardship !== 'self' || !row.claimedByUserId) return false;
  const [latest] = await tx
    .select({ action: consentRecord.action })
    .from(consentRecord)
    .where(and(eq(consentRecord.userId, row.claimedByUserId), eq(consentRecord.kind, 'publication')))
    .orderBy(sql`${consentRecord.occurredAt} DESC`, sql`${consentRecord.id} DESC`)
    .limit(1);
  return latest?.action === 'withdrawn';
}

/** A staff member does not take down or restore a record that is theirs: another one does. */
function refuseOwn(actor: Principal, row: Held): void {
  if (row.claimedByUserId === actor.user.id) throw new ServiceError('FORBIDDEN', 'This record is yours: another member of staff handles it.');
}

/**
 * The public cache tags a take-down or restore can touch: the person and the lineages above and
 * around it (as the owner's own change of visibility drops them), and the lists that show people:
 * schools (instructors), events (organizers) and organizations (members).
 */
async function tagsOf(tx: Transaction, personId: string): Promise<string[]> {
  return [...(await neighbourTags(tx, personId, { ancestors: true })), SCHOOLS_TAG, EVENTS_TAG, ORGANIZATIONS_TAG];
}

export interface TakeDownApplied extends TakedownResult {
  /** Public cache tags to drop after the commit. */
  tags: string[];
}

/**
 * The write of a take-down, inside the caller's transaction (takeDownProfile; the upheld report of
 * review-kinds.ts). The caller has checked who the actor is.
 */
export async function applyTakeDown(
  tx: Transaction,
  actor: Principal,
  input: { personId: string; reason: string; caseId: string | null },
  meta: RequestMeta,
): Promise<TakeDownApplied> {
  if (input.caseId) await checkCase(tx, input.caseId, input.personId);
  const row = await lockPerson(tx, input.personId);
  refuseOwn(actor, row);
  if (row.takenDownAt) return { personId: row.id, slug: row.slug, takenDown: true, visibility: row.visibility, changed: false, tags: [] };

  await tx
    .update(person)
    .set({ visibility: 'involved_only', takenDownAt: new Date(), takenDownReason: input.reason, takenDownVisibility: row.visibility, updatedAt: new Date() })
    .where(eq(person.id, row.id));
  // Every public edge of the person goes: lineage_membership follows.
  if (row.visibility === 'public') await queueRecomputeForPerson(tx, row.id);

  await writeAudit(tx, {
    action: 'person.takedown',
    actorUserId: actor.user.id,
    actorRole: actor.user.role,
    subjectType: 'person',
    subjectId: row.id,
    before: { visibility: row.visibility },
    after: { visibility: 'involved_only', held: true, stewardship: row.stewardship, caseId: input.caseId },
    reason: input.reason,
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  if (input.caseId) await noteOnCase(tx, actor, input.caseId, `Profile taken down. Reason: ${input.reason}`);
  // The owner, when the record has an account, reads the reason (a statement of reasons).
  if (row.claimedByUserId) {
    await notify(tx, row.claimedByUserId, 'profile.taken-down', { reason: input.reason }, { key: `profile.taken-down:${row.id}:${uuidv7()}` });
  }
  return { personId: row.id, slug: row.slug, takenDown: true, visibility: 'involved_only', changed: true, tags: await tagsOf(tx, row.id) };
}

/** The write of a restore, inside the caller's transaction. */
async function applyRestore(
  tx: Transaction,
  actor: Principal,
  input: { personId: string; reason: string; caseId: string | null },
  meta: RequestMeta,
): Promise<TakeDownApplied> {
  if (input.caseId) await checkCase(tx, input.caseId, input.personId);
  const row = await lockPerson(tx, input.personId);
  refuseOwn(actor, row);
  if (!row.takenDownAt) return { personId: row.id, slug: row.slug, takenDown: false, visibility: row.visibility, changed: false, tags: [] };

  // What the record was (or what its owner chose since, setOwnVisibility), unless the owner has
  // withdrawn the publication consent in the meantime: then it stays private (DEFAULT D03).
  const wanted = row.takenDownVisibility ?? 'involved_only';
  const visibility = wanted === 'public' && !(await ownerWithdrewPublication(tx, row)) ? 'public' : 'involved_only';
  await tx
    .update(person)
    .set({ visibility, takenDownAt: null, takenDownReason: null, takenDownVisibility: null, updatedAt: new Date() })
    .where(eq(person.id, row.id));
  if (visibility === 'public') await queueRecomputeForPerson(tx, row.id);

  await writeAudit(tx, {
    action: 'person.restore',
    actorUserId: actor.user.id,
    actorRole: actor.user.role,
    subjectType: 'person',
    subjectId: row.id,
    before: { visibility: row.visibility, held: true },
    after: { visibility, held: false, stewardship: row.stewardship, caseId: input.caseId },
    reason: input.reason,
    requestId: meta.requestId,
    ipHmac: meta.ipHmac,
  });
  if (input.caseId) await noteOnCase(tx, actor, input.caseId, `Profile restored. Reason: ${input.reason}`);
  if (row.claimedByUserId) {
    await notify(tx, row.claimedByUserId, 'profile.restored', { visible: visibility === 'public' }, { key: `profile.restored:${row.id}:${uuidv7()}` });
  }
  return { personId: row.id, slug: row.slug, takenDown: false, visibility, changed: true, tags: await tagsOf(tx, row.id) };
}

/** An internal note on the case (reviewers only): what staff did to the record. */
async function noteOnCase(tx: Transaction, actor: Principal, caseId: string, body: string): Promise<void> {
  await tx.insert(reviewNote).values({ reviewCaseId: caseId, authorUserId: actor.user.id, body, isInternal: true });
  await tx.update(reviewCase).set({ updatedAt: new Date() }).where(eq(reviewCase.id, caseId));
}

function parseOrThrow<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
  throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);
}

/** The result without the cache tags, which are for the caller's own revalidation only. */
function publicResult(result: TakedownResult & { tags: string[] }): TakedownResult {
  return { personId: result.personId, slug: result.slug, takenDown: result.takenDown, visibility: result.visibility, changed: result.changed };
}

/**
 * moderation.takeDown: takes a person record off every public surface, with a reason. A moderator
 * or an administrator with a verified second factor. Works for a self-kept profile and for an
 * unclaimed, archive-kept or historical one. Asking again for a record already held changes nothing.
 */
export async function takeDownProfile(principal: Principal | null, raw: TakeDownInput, meta: RequestMeta): Promise<TakedownResult> {
  const actor = requireStaff2FA(principal, TAKEDOWN_ROLES);
  const input = parseOrThrow(takeDownInput, raw);
  const result = await getDb().transaction((tx) => applyTakeDown(tx, actor, input, meta));
  invalidatePublic(result.tags, 'procedure');
  return publicResult(result);
}

/** moderation.restore: puts a taken-down record back (see the top of this file). */
export async function restoreProfile(principal: Principal | null, raw: RestoreInput, meta: RequestMeta): Promise<TakedownResult> {
  const actor = requireStaff2FA(principal, TAKEDOWN_ROLES);
  const input = parseOrThrow(restoreInput, raw);
  const result = await getDb().transaction((tx) => applyRestore(tx, actor, input, meta));
  invalidatePublic(result.tags, 'procedure');
  return publicResult(result);
}
