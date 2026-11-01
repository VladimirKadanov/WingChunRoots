// Arbitration (milestone M10b, In scope 5; plan §6.7, DEFAULT D19). A moderator or an
// administrator, with a session that proved the second factor, sets a verified relationship in
// arbitration with a reason:
//
//   review.arbitrate
//     → the relationship verified → in_arbitration (its visibility unchanged: public pages show it
//       as "Disputed", in words and with the arbitration seal, never by colour alone);
//     → a review_case of kind relationship_dispute, needs_info and assigned to them, with the reason
//       as a note both parties read;
//     → relationship_event (verified → in_arbitration, reason arbitration), review_event (open) and
//       the audit row relationship.arbitration with the reason (plan §6.7: "the reason in the audit");
//     → both parties: a dashboard notification and an e-mail with the reason and the link to the
//       case page, where they send evidence (/dashboard/cases/<id>).
//   The dispute is then decided with review.decide (review-kinds.ts): verified again, or revoked.
//
// The full dispute and appeal procedure is Phase 3 (plan §2): in the pilot this is manual.

import { eq } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireStaff2FA } from '../auth/guards';
import type { Principal, StaffRole } from '../auth/principal';
import { invalidatePublic } from '../cache';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { reviewCase, reviewNote, teachingRelationship } from '../db/schema';
import type { RequestMeta } from './context';
import { pgErrorOf, ServiceError } from './errors';
import { fieldErrors, idempotencyKey, isKeyConflict, keyReused, publicTags, recordEvent, rowById } from './relationships';
import { caseReplayOf, DECIDERS, isCaseKeyConflict, ownSide, recordCaseEvent } from './review-core';
import { tellDisputeParties } from './review-kinds';

export const ARBITRATION_REASON_MAX = 2000;
const ARBITERS: readonly StaffRole[] = DECIDERS.relationship_dispute;

export const arbitrateInput = z.object({
  relationshipId: z.uuid({ error: 'No such relationship.' }),
  reason: z
    .string({ error: 'Write the reason both parties will read.' })
    .max(ARBITRATION_REASON_MAX * 2, { error: `Use at most ${ARBITRATION_REASON_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length > 0, { error: 'Write the reason both parties will read.' })
    .refine((s) => s.length <= ARBITRATION_REASON_MAX, { error: `Use at most ${ARBITRATION_REASON_MAX} characters.` }),
  idempotencyKey,
});

export interface ArbitrateResult {
  caseId: string;
  replayed: boolean;
}

/** review.arbitrate: a moderator or an administrator sets a verified relationship in arbitration. */
export async function arbitrateRelationship(principal: Principal | null, raw: z.input<typeof arbitrateInput>, meta: RequestMeta): Promise<ArbitrateResult> {
  const p = requireStaff2FA(principal);
  if (!ARBITERS.includes(p.user.role)) throw new ServiceError('FORBIDDEN', 'A moderator or an administrator sets a relationship in arbitration.');
  const parsed = arbitrateInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  try {
    const outcome = await db.transaction(async (tx) => {
      const row = await rowById(tx, input.relationshipId, true);
      if (!row) throw new ServiceError('NOT_FOUND', 'No such relationship.');
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        const [earlier] = await tx.select({ kind: reviewCase.kind, relationshipId: reviewCase.relationshipId }).from(reviewCase).where(eq(reviewCase.id, replay.caseId));
        if (replay.action !== 'open' || earlier?.kind !== 'relationship_dispute' || earlier.relationshipId !== row.id) throw keyReused();
        return { caseId: replay.caseId, replayed: true, tags: [] as string[] };
      }
      // Nobody arbitrates a relationship of their own.
      if (await ownSide(tx, p, { kind: 'relationship_dispute', relationshipId: row.id, openedByUserId: null, personId: null })) {
        throw new ServiceError('FORBIDDEN', 'This relationship is yours: another moderator or an administrator handles it.');
      }
      if (row.status !== 'verified') {
        throw new ServiceError('CONFLICT', row.status === 'in_arbitration' ? 'This relationship is already in arbitration.' : 'Only a verified relationship can be set in arbitration.');
      }
      const now = new Date();
      await tx.update(teachingRelationship).set({ status: 'in_arbitration', statusReason: 'arbitration', updatedAt: now }).where(eq(teachingRelationship.id, row.id));
      await recordEvent(tx, { relationshipId: row.id, from: 'verified', to: 'in_arbitration', actor: p, role: p.user.role, reason: 'arbitration', key: input.idempotencyKey });
      const caseId = uuidv7();
      // DEFAULT D19: the case asks both parties for evidence at once (needs_info), and is the
      // moderator's own until they give it to another reviewer.
      await tx.insert(reviewCase).values({ id: caseId, kind: 'relationship_dispute', status: 'needs_info', relationshipId: row.id, openedByUserId: p.user.id, assignedToUserId: p.user.id });
      await tx.insert(reviewNote).values({ reviewCaseId: caseId, authorUserId: p.user.id, body: input.reason, isInternal: false });
      const eventId = await recordCaseEvent(tx, { caseId, action: 'open', from: null, to: 'needs_info', actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'relationship.arbitration',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'teaching_relationship',
        subjectId: row.id,
        before: { status: 'verified', visibility: row.visibility },
        after: { status: 'in_arbitration', visibility: row.visibility, caseId },
        reason: input.reason,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellDisputeParties(tx, row, caseId, 'opened', input.reason, eventId);
      return { caseId, replayed: false, tags: await publicTags(tx, row) };
    });
    if (outcome.tags.length > 0) invalidatePublic(outcome.tags, 'procedure');
    return { caseId: outcome.caseId, replayed: outcome.replayed };
  } catch (error) {
    if (isCaseKeyConflict(error) || isKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'review_case_one_open_per_relationship_key') throw new ServiceError('CONFLICT', 'This relationship is already in arbitration.');
    throw error;
  }
}
