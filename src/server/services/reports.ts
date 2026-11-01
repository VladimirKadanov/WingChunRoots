// "Report profile" (milestone M10b, In scope 4; plan §6.2). A signed-in account reports a public
// profile for one of four reasons (copyright, spam, inappropriate, misleading), with optional
// details: a content_report row and a review_case of kind profile_report, open, which a moderator or
// an administrator upholds or dismisses (review.decide, review-kinds.ts).
//
//   reports.mine    the account's own reports (which profiles, why, where each stands)
//   reports.create  one report per account and profile, ever (a unique index); a few a day,
//                   counted under the account's case lock (review-core.ts lockAccountCases)
//
// No automatic hiding (the milestone's brief): a report changes nothing public by itself. Nobody
// reports their own profile, and a profile that is not public is "not found", as everywhere.

import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { contentReport, person, reviewCase } from '../db/schema';
import { REPORT_DETAILS_MAX, REPORT_REASONS } from '../db/schema/common';
import { REPORT_REASON_LABELS, type ReportReason } from '../templates/review';
import type { RequestMeta } from './context';
import { pgErrorOf, ServiceError } from './errors';
import { fieldErrors, idempotencyKey, keyReused, viewerOf } from './relationships';
import { caseReplayOf, isCaseKeyConflict, lockAccountCases, recordCaseEvent, tellStaff } from './review-core';

/** At most this many reports of one account in 24 hours. */
export const REPORTS_PER_DAY = 10;
export const ALREADY_REPORTED = 'You have already reported this profile. The moderators have your report.';

export const reportInput = z.object({
  personId: z.uuid({ error: 'No such profile.' }),
  reason: z.enum(REPORT_REASONS, { error: 'Choose a reason.' }),
  details: z
    .string()
    .max(REPORT_DETAILS_MAX * 2, { error: `Use at most ${REPORT_DETAILS_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length <= REPORT_DETAILS_MAX, { error: `Use at most ${REPORT_DETAILS_MAX} characters.` })
    .nullish()
    .transform((s) => (s ? s : null)),
  idempotencyKey,
});
export type ReportInput = z.input<typeof reportInput>;

export interface MyReport {
  personId: string;
  reason: ReportReason;
  reasonLabel: string;
  status: 'open' | 'triaged' | 'resolved' | 'dismissed';
  createdAt: string;
}

/** reports.mine: the signed-in account's reports of profiles, newest first. */
export async function myReports(principal: Principal | null): Promise<{ reports: MyReport[] }> {
  const p = requireUser(principal);
  const rows = await getDb()
    .select({ personId: contentReport.subjectId, reason: contentReport.reason, status: contentReport.status, createdAt: contentReport.createdAt })
    .from(contentReport)
    .where(and(eq(contentReport.reporterUserId, p.user.id), eq(contentReport.subjectType, 'person')))
    .orderBy(desc(contentReport.createdAt))
    .limit(200);
  return { reports: rows.map((r) => ({ ...r, reasonLabel: REPORT_REASON_LABELS[r.reason], createdAt: r.createdAt.toISOString() })) };
}

export interface ReportResult {
  caseId: string;
  replayed: boolean;
}

/** reports.create: the signed-in account reports a public profile (see the top of this file). */
export async function reportProfile(principal: Principal | null, raw: ReportInput, meta: RequestMeta): Promise<ReportResult> {
  const p = requireUser(principal);
  const parsed = reportInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      // The account's case lock first: reports sent at the same time are counted one after the other.
      await lockAccountCases(tx, p.user.id);
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        const [earlier] = await tx.select({ kind: reviewCase.kind, personId: reviewCase.personId }).from(reviewCase).where(eq(reviewCase.id, replay.caseId));
        if (replay.action !== 'open' || earlier?.kind !== 'profile_report' || earlier.personId !== input.personId) throw keyReused();
        return { caseId: replay.caseId, replayed: true };
      }
      const [target] = await tx
        .select({ id: person.id, isPublic: sql<boolean>`EXISTS (SELECT 1 FROM v_public_person vp WHERE vp.id = ${input.personId}::uuid)` })
        .from(person)
        .where(eq(person.id, input.personId));
      if (!target || !target.isPublic) throw new ServiceError('NOT_FOUND', 'No such profile.');
      const viewer = await viewerOf(tx, p);
      if (viewer.personId === target.id) throw new ServiceError('FORBIDDEN', 'You can’t report your own profile. Edit it in Your profile instead.');
      const [earlier] = await tx
        .select({ id: contentReport.id })
        .from(contentReport)
        .where(and(eq(contentReport.reporterUserId, p.user.id), eq(contentReport.subjectType, 'person'), eq(contentReport.subjectId, target.id)));
      if (earlier) throw new ServiceError('CONFLICT', ALREADY_REPORTED);
      const [recent] = await tx
        .select({ n: count() })
        .from(contentReport)
        .where(and(eq(contentReport.reporterUserId, p.user.id), gt(contentReport.createdAt, new Date(Date.now() - 86_400_000))));
      if ((recent?.n ?? 0) >= REPORTS_PER_DAY) throw new ServiceError('TOO_MANY_REQUESTS', 'You have sent many reports today. You can send more tomorrow.');

      const caseId = uuidv7();
      await tx.insert(reviewCase).values({ id: caseId, kind: 'profile_report', status: 'open', personId: target.id, openedByUserId: p.user.id });
      const reportId = uuidv7();
      await tx.insert(contentReport).values({
        id: reportId,
        subjectType: 'person',
        subjectId: target.id,
        reason: input.reason,
        details: input.details,
        reporterUserId: p.user.id,
        status: 'open',
        reviewCaseId: caseId,
      });
      await recordCaseEvent(tx, { caseId, action: 'open', from: null, to: 'open', actor: p, key: input.idempotencyKey });
      await writeAudit(tx, {
        action: 'report.create',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'person',
        subjectId: target.id,
        after: { reportId, caseId, reason: input.reason, details: input.details !== null },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      await tellStaff(tx, caseId, 'profile_report', [p.user.id]);
      return { caseId, replayed: false };
    });
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'content_report_one_per_reporter_key') throw new ServiceError('CONFLICT', ALREADY_REPORTED);
    throw error;
  }
}
