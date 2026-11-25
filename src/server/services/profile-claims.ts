// "Is this you? Ask to claim this profile" (usability round after M26; ADR 0040): a signed-in
// account without a profile of its own asks the reviewers to make a public record its own, from
// the record's page (/people/<slug>/claim), without an invitation.
//
//   claims.get      whether this record can be claimed, and whether this account can claim it now
//                   (the refusal in words, the case of a claim it already has waiting)
//   claims.request  the claim: the SAME review case of kind person_claim and the same person_claim
//                   an invitation's claim makes (invitations.ts openPersonClaim), without a
//                   relationship; an archivist or an administrator decides it (review.decide,
//                   review-kinds.ts). Approved, the record becomes the account's own
//                   (claimed_by_user_id, stewardship self) and keeps its visibility; refused, it
//                   stays as it was.
//
// Which records (M10b's rule for claims, ADR 0013 §3, with the ADR 0031 living gates): a living
// person's record (kind living, life status living), public, unclaimed (stewardship unclaimed, no
// account), not taken down and not deleted. A record of a historical or deceased person and a
// record kept by the archive (stewardship platform) are shared archival records: they are corrected
// by proposal (/people/<slug>/record), never claimed. A record that is not public is not found here,
// as on its page (plan §6.4).
//
// Which accounts: the same as for an invitation (claimantRefusal): no profile of its own, no other
// claim waiting for the reviewers (one at a time), the current documents confirmed; and at most
// SELF_CLAIMS_PER_DAY requests in 24 hours (DEFAULT, ADR 0040), counted under the account's case
// lock, as instructor requests and reports are. Several accounts may claim the same record; the
// reviewers approve one at most (the unique claimed_by_user_id and the record's stewardship decide).
//
// Logs and audit rows carry ids only; the claimant's note stays in the case (plan §6.4).

import { and, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { person, reviewCase, reviewEvent } from '../db/schema';
import { OPEN_REVIEW_CASE_STATUSES } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import type { RequestMeta } from './context';
import { pgErrorOf, ServiceError } from './errors';
import { CLAIM_NOTE_MAX, claimantRefusal, CONFIRM_DOCUMENTS, openPersonClaim } from './invitations';
import { fieldErrors, idempotencyKey, keyReused } from './relationships';
import { caseReplayOf, isCaseKeyConflict, lockAccountCases } from './review-core';

/** DEFAULT (ADR 0040): at most this many profile claims from profile pages by one account in 24 hours. */
export const SELF_CLAIMS_PER_DAY = 3;
const DAY_MS = 86_400_000;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NOT_PUBLIC = 'This profile is not on the public record.';
const OWN_PROFILE = 'Your account already has its own profile, so it cannot claim another one. If this record is also about you, report it from its page and the moderators will look at it.';

export const claimGetInput = z.object({ slug: z.string().max(120) });

export const claimRequestInput = z.object({
  personId: z.uuid({ error: 'Choose a profile.' }),
  /** For the reviewers: who you are and how they can check it. Never public. */
  note: z
    .string({ error: 'Tell the reviewers who you are and how they can check it.' })
    .max(CLAIM_NOTE_MAX * 2, { error: `Use at most ${CLAIM_NOTE_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length > 0, { error: 'Tell the reviewers who you are and how they can check it.' })
    .refine((s) => s.length <= CLAIM_NOTE_MAX, { error: `Use at most ${CLAIM_NOTE_MAX} characters.` }),
  idempotencyKey,
});

export type ClaimRequestInput = z.input<typeof claimRequestInput>;

interface RecordRow {
  id: string;
  kind: 'living' | 'historical';
  lifeStatus: 'living' | 'deceased' | 'unknown';
  stewardship: 'self' | 'platform' | 'unclaimed';
  claimedBy: string | null;
  isPublic: boolean;
}

const recordColumns = {
  id: person.id,
  kind: person.kind,
  lifeStatus: person.lifeStatus,
  stewardship: person.stewardship,
  claimedBy: person.claimedByUserId,
  // The public view's own rule (not taken down, not deleted, public): as the record's page. The
  // column is named with its table: inside the subquery a bare "id" would be the view's own.
  isPublic: sql<boolean>`EXISTS (SELECT 1 FROM v_public_person vp WHERE vp.id = "person"."id")`,
};

/** Why this record cannot be claimed from its page, or null (see the top of this file). */
function recordRefusal(record: RecordRow, viewerId: string): string | null {
  if (record.claimedBy === viewerId) return 'This is your own profile already.';
  if (record.claimedBy || record.stewardship === 'self') return 'This profile already belongs to an account, so it cannot be claimed.';
  if (record.kind !== 'living' || record.lifeStatus !== 'living') {
    return 'This is the record of a historical teacher or of someone who has died, so it cannot be claimed. If something on it is wrong, propose a correction from its page.';
  }
  if (record.stewardship !== 'unclaimed') return 'This record is kept by the archive, so it cannot be claimed. If something on it is wrong, propose a correction from its page.';
  return null;
}

/** The account's open claim of this record, if it has one (its case). */
async function openClaimOf(db: Executor, userId: string, personId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: reviewCase.id })
    .from(reviewCase)
    .where(and(eq(reviewCase.kind, 'person_claim'), eq(reviewCase.personId, personId), eq(reviewCase.openedByUserId, userId), inArray(reviewCase.status, [...OPEN_REVIEW_CASE_STATUSES])))
    .limit(1);
  return row?.id ?? null;
}

/** How many claims from profile pages the account opened in the last 24 hours. */
async function recentSelfClaims(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(reviewEvent)
    .innerJoin(reviewCase, eq(reviewCase.id, reviewEvent.reviewCaseId))
    .where(
      and(
        eq(reviewEvent.actorUserId, userId),
        eq(reviewEvent.action, 'open'),
        eq(reviewCase.kind, 'person_claim'),
        isNull(reviewCase.relationshipId),
        gt(reviewEvent.createdAt, new Date(Date.now() - DAY_MS)),
      ),
    );
  return row?.n ?? 0;
}

const TOO_MANY = 'You have sent several profile claims today. You can send another one tomorrow.';

// --- claims.get --------------------------------------------------------------------------------

export interface ClaimOptionView {
  personId: string;
  /** The record can be claimed from its page: living, public, unclaimed. */
  claimable: boolean;
  /** Why it cannot, when it cannot (the record's side). */
  recordRefusal: string | null;
  viewer: {
    /** Why this account cannot claim it now (its side): own profile, a claim waiting, documents, the day's limit. */
    refusal: string | null;
    /** The refusal is the current documents, which /onboarding asks this account to confirm. */
    confirmDocuments: boolean;
    /** The case of the claim this account has waiting for the reviewers, of this record or another. */
    waitingCaseId: string | null;
    /** The waiting claim is of this record. */
    waitingHere: boolean;
    /**
     * ADR 0056: the account has a profile of its own. If the record is about them as well, the page
     * offers to report it as a second profile of one person (the moderators correct or remove it);
     * without one, on a record that cannot be claimed, it offers to set up their own.
     */
    ownProfile: boolean;
  };
}

/** claims.get: whether the signed-in account can ask to claim the public record `slug` now. */
export async function getClaimOption(principal: Principal | null, raw: z.input<typeof claimGetInput>): Promise<ClaimOptionView> {
  const p = requireUser(principal);
  const parsed = claimGetInput.safeParse(raw);
  if (!parsed.success || !SLUG.test(parsed.data.slug)) throw new ServiceError('NOT_FOUND', NOT_PUBLIC);
  const db = getDb();
  const [record] = await db.select(recordColumns).from(person).where(and(eq(person.slug, parsed.data.slug), isNull(person.deletedAt)));
  if (!record || !record.isPublic) throw new ServiceError('NOT_FOUND', NOT_PUBLIC);
  const refusedRecord = recordRefusal(record, p.user.id);
  const here = await openClaimOf(db, p.user.id, record.id);
  // The account's own refusal is read for a record that cannot be claimed too: the page then offers
  // a profile of its own only to an account that has none (ADR 0056); it is said only otherwise.
  const accountCheck = await claimantRefusal(db, p, OWN_PROFILE);
  const account = refusedRecord ? null : accountCheck;
  const limited = !refusedRecord && !account && (await recentSelfClaims(db, p.user.id)) >= SELF_CLAIMS_PER_DAY;
  const refusal = account?.message ?? (limited ? TOO_MANY : null);
  return {
    personId: record.id,
    claimable: refusedRecord === null,
    recordRefusal: refusedRecord,
    viewer: {
      refusal,
      confirmDocuments: refusal === CONFIRM_DOCUMENTS,
      waitingCaseId: here ?? account?.waitingCaseId ?? null,
      waitingHere: here !== null,
      ownProfile: accountCheck?.message === OWN_PROFILE,
    },
  };
}

// --- claims.request ----------------------------------------------------------------------------

export interface ClaimRequestResult {
  caseId: string;
  replayed: boolean;
}

/**
 * claims.request: the signed-in account asks to claim a public record (see the top of this file).
 * In one transaction: the account's case lock, a replayed key, the record FOR UPDATE and its
 * checks, the account's checks and the day's limit, then the claim's writes (openPersonClaim).
 */
export async function requestProfileClaim(principal: Principal | null, raw: ClaimRequestInput, meta: RequestMeta): Promise<ClaimRequestResult> {
  const p = requireUser(principal);
  const parsed = claimRequestInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      // The account's case lock before any row lock (review-core.ts): two claims sent at once by
      // one account are checked one after the other, so it holds one waiting claim.
      await lockAccountCases(tx, p.user.id);
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        const [earlier] = await tx.select({ kind: reviewCase.kind, personId: reviewCase.personId, relationshipId: reviewCase.relationshipId }).from(reviewCase).where(eq(reviewCase.id, replay.caseId));
        if (replay.action !== 'open' || earlier?.kind !== 'person_claim' || earlier.personId !== input.personId || earlier.relationshipId !== null) throw keyReused();
        return { caseId: replay.caseId, replayed: true };
      }
      const [record] = await tx.select(recordColumns).from(person).where(and(eq(person.id, input.personId), isNull(person.deletedAt))).for('update', { of: person });
      if (!record || !record.isPublic) throw new ServiceError('NOT_FOUND', NOT_PUBLIC);
      const refusedRecord = recordRefusal(record, p.user.id);
      if (refusedRecord) throw new ServiceError('CONFLICT', refusedRecord);
      const account = await claimantRefusal(tx, p, OWN_PROFILE);
      if (account) throw new ServiceError('CONFLICT', account.message);
      if ((await recentSelfClaims(tx, p.user.id)) >= SELF_CLAIMS_PER_DAY) throw new ServiceError('TOO_MANY_REQUESTS', TOO_MANY);
      const caseId = await openPersonClaim(tx, p, { personId: record.id, relationshipId: null, note: input.note, key: input.idempotencyKey, after: { source: 'profile_page' } }, meta);
      return { caseId, replayed: false };
    });
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'person_claim_one_pending_key') throw new ServiceError('CONFLICT', 'You already have a profile claim waiting for the reviewers.');
    throw error;
  }
}
