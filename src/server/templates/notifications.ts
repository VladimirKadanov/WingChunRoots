// The texts of dashboard notifications (plan §6.1, §6.2; milestone M01b, In scope 3). English
// only, and the only place with notification text: a `notification` row stores a template name
// and a payload, and the dashboard (M08) renders it through renderNotification().
//
// A body is a list of segments rather than one string, so that a person's name keeps its `lang`
// attribute and translate="no" when the dashboard renders it (plan §5.3).

import { formatDay, untilPlanEnd } from '../../lib/dates';
import { GRANTABLE_PLANS, type PlanCode, PLANS } from '../entitlements/plans';
import type { NameData } from './email/types';
import { rejectionReasonText } from './relationships';

export type NotificationSegment = { text: string } | { name: NameData };

export interface RenderedNotification {
  title: string;
  body: NotificationSegment[];
  /** A link to where the notification is acted on (M08): a local path, never another site. */
  action?: { label: string; href: string };
}

/** What the stored row adds to its payload: when the notification was created. */
export interface NotificationContext {
  createdAt?: Date;
}

export interface NotificationTemplate<Data> {
  readonly name: string;
  /** Checks untrusted data (the jsonb payload); throws NotificationDataError. */
  parse(payload: unknown): Data;
  render(data: Data, context: NotificationContext): RenderedNotification;
  /** Fictional example data (D20) for the tests. */
  readonly sample: Data;
}

export class NotificationDataError extends Error {
  constructor(template: string, problem: string) {
    super(`notification ${template}: ${problem}`);
    this.name = 'NotificationDataError';
  }
}

/** "mail-check.sent": a mail check was sent to the address of the account (pnpm mail:check). */
const mailCheckSent: NotificationTemplate<Record<string, never>> = {
  name: 'mail-check.sent',
  parse(payload) {
    if (payload !== undefined && payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
      throw new NotificationDataError('mail-check.sent', 'payload must be an object');
    }
    return {};
  },
  render: () => ({
    title: 'Mail check sent',
    body: [{ text: 'A test message was sent to the e-mail address of your account. You do not need to do anything.' }],
  }),
  sample: {},
};

// --- Plans (M08) ---------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

function payloadObject(template: string, payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new NotificationDataError(template, 'payload must be an object');
  }
  return payload as Record<string, unknown>;
}

function grantablePlan(template: string, value: unknown): PlanCode {
  if (typeof value !== 'string' || !(GRANTABLE_PLANS as readonly string[]).includes(value)) {
    throw new NotificationDataError(template, 'planCode must be a plan an admin can grant');
  }
  return value as PlanCode;
}

function optionalName(template: string, value: unknown): NameData | null {
  if (value === undefined || value === null) return null;
  const { value: text, lang } = value as Partial<Record<keyof NameData, unknown>>;
  if (typeof text !== 'string' || text.trim() === '' || text.length > 200 || typeof lang !== 'string' || !LANG.test(lang)) {
    throw new NotificationDataError(template, 'requester must be a name with a language tag');
  }
  return { value: text.trim(), lang };
}

function optionalDate(template: string, key: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new NotificationDataError(template, `${key} must be a date`);
  return value;
}

interface PilotAccessRequested {
  requestId: string;
  planCode: PlanCode;
  /**
   * Not stored: services/notifications.ts adds the requester's current name (null without a
   * profile) when an admin's list is read, and `requesterDeleted` when the account is gone.
   */
  requester: NameData | null;
  requesterDeleted: boolean;
  /**
   * Not stored either: true when the session reading the list has not proved the second factor
   * (M08 review round 2, recheck-1). The text then names neither the account nor the plan.
   */
  requesterHidden: boolean;
  /**
   * Not stored either (M08 final check, screens-4): true once the request is no longer open, given
   * or closed, by this admin or another. The notification then says so and offers no review.
   */
  answered: boolean;
}

/**
 * "pilot-access.requested": to every admin, when an account asks for pilot access from an
 * upgrade prompt (plan §5.6). No payment exists in the pilot; the admin may give a test plan.
 */
const pilotAccessRequested: NotificationTemplate<PilotAccessRequested> = {
  name: 'pilot-access.requested',
  parse(payload) {
    const data = payloadObject('pilot-access.requested', payload);
    if (typeof data.requestId !== 'string' || !UUID.test(data.requestId)) {
      throw new NotificationDataError('pilot-access.requested', 'requestId must be a UUID');
    }
    return {
      requestId: data.requestId,
      planCode: grantablePlan('pilot-access.requested', data.planCode),
      requester: optionalName('pilot-access.requested', data.requester),
      requesterDeleted: data.requesterDeleted === true,
      requesterHidden: data.requesterHidden === true,
      answered: data.answered === true,
    };
  },
  render: ({ requestId, planCode, requester, requesterDeleted, requesterHidden, answered }) =>
    requesterHidden
      ? {
          title: 'Pilot access requested',
          body: [{ text: 'An account asked for pilot access. Confirm this session with your authenticator app to see who asked and for which plan.' }],
          // /admin/grants asks for the second factor first and then opens the request (recheck-7).
          action: { label: 'Review the request', href: `/admin/grants?request=${requestId}#give-plan` },
        }
      : requesterDeleted
      ? {
          title: 'Pilot access requested',
          body: [{ text: `A since deleted account asked for pilot access to ${PLANS[planCode].name}. The request was removed with the account.` }],
        }
      : answered
      ? {
          title: 'Pilot access requested',
          // Given or closed, possibly by another administrator: nothing left to review (screens-4).
          body: [
            requester ? { name: requester } : { text: 'An account without a profile' },
            { text: ` asked for ${PLANS[planCode].name}. The request has already been answered.` },
          ],
        }
      : {
          title: 'Pilot access requested',
          body: [requester ? { name: requester } : { text: 'An account without a profile' }, { text: ` asked for ${PLANS[planCode].name}.` }],
          // Straight to the form, filled in with the request (/admin/grants opens it for ?request=).
          action: { label: 'Review the request', href: `/admin/grants?request=${requestId}#give-plan` },
        },
  sample: {
    requestId: '0190a5c0-0000-7000-8000-000000000001',
    planCode: 'pro_sifu',
    requester: { value: 'Demo Sifu Example', lang: 'und-Latn' },
    requesterDeleted: false,
    requesterHidden: false,
    answered: false,
  },
};

interface PlanGranted {
  planCode: PlanCode;
  /** The grant's start; null in rows written before review round 1 (they started at once). */
  startsAt: string | null;
  endsAt: string | null;
}

/** The plan notifications lead to the account's plan, not to the dashboard they are shown on. */
const SEE_YOUR_PLAN = { label: 'See your plan', href: '/dashboard/settings' } as const;

/**
 * "plan.granted": to the account an admin gave a test or complimentary plan (M08). A grant that
 * starts after the notification says from when (review round 1, security-4): until then the
 * account's plan has not changed.
 */
const planGranted: NotificationTemplate<PlanGranted> = {
  name: 'plan.granted',
  parse(payload) {
    const data = payloadObject('plan.granted', payload);
    return {
      planCode: grantablePlan('plan.granted', data.planCode),
      startsAt: optionalDate('plan.granted', 'startsAt', data.startsAt),
      endsAt: optionalDate('plan.granted', 'endsAt', data.endsAt),
    };
  },
  render: ({ planCode, startsAt, endsAt }, { createdAt }) => {
    const later = startsAt !== null && createdAt !== undefined && Date.parse(startsAt) > createdAt.getTime();
    const from = later ? ` from ${formatDay(startsAt)}` : '';
    return {
      title: `Pilot plan added: ${PLANS[planCode].name}`,
      body: [
        {
          text: `An administrator gave your account ${PLANS[planCode].name} for the pilot${from}${endsAt ? `, ${untilPlanEnd(endsAt)}` : ''}. No payment is involved.`,
        },
      ],
      action: SEE_YOUR_PLAN,
    };
  },
  sample: { planCode: 'pro_sifu', startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z' },
};

/** "plan.revoked": to the account whose test or complimentary plan an admin ended (M08). */
const planRevoked: NotificationTemplate<{ planCode: PlanCode }> = {
  name: 'plan.revoked',
  parse(payload) {
    return { planCode: grantablePlan('plan.revoked', payloadObject('plan.revoked', payload).planCode) };
  },
  render: ({ planCode }) => ({
    title: `Pilot plan ended: ${PLANS[planCode].name}`,
    body: [
      {
        // A Student plan approves nobody, so only a Sifu plan speaks of approvals (DEFAULT D06/D08).
        text:
          PLANS[planCode].audience === 'sifu'
            ? `An administrator ended your pilot plan ${PLANS[planCode].name}. Every confirmed link stays confirmed and public; only new approvals above your plan's limit wait.`
            : `An administrator ended your pilot plan ${PLANS[planCode].name}. Your profile and every confirmed link stay as they are.`,
      },
    ],
    action: SEE_YOUR_PLAN,
  }),
  sample: { planCode: 'pro_sifu' },
};

/**
 * "pilot-access.closed": to the account whose pilot access request an admin closed without giving
 * the plan (M08 review round 2, recheck-5). The admin's reason stays in the audit log.
 */
const pilotAccessClosed: NotificationTemplate<{ planCode: PlanCode }> = {
  name: 'pilot-access.closed',
  parse(payload) {
    return { planCode: grantablePlan('pilot-access.closed', payloadObject('pilot-access.closed', payload).planCode) };
  },
  render: ({ planCode }) => ({
    title: 'Pilot access request closed',
    body: [
      {
        text: `An administrator closed your request for pilot access to ${PLANS[planCode].name} without giving the plan. Your plan has not changed and nothing is charged.`,
      },
    ],
    action: SEE_YOUR_PLAN,
  }),
  sample: { planCode: 'pro_sifu' },
};

// --- Account deletion (M07) -----------------------------------------------------------------------

/**
 * "account.deletion-requested": to every admin, when an account asks to be deleted from
 * /account/privacy (milestone M07). The payload holds the review case id only; /admin lists who
 * asked, for a session that proved the second factor.
 */
const accountDeletionRequested: NotificationTemplate<{ caseId: string }> = {
  name: 'account.deletion-requested',
  parse(payload) {
    const data = payloadObject('account.deletion-requested', payload);
    if (typeof data.caseId !== 'string' || !UUID.test(data.caseId)) {
      throw new NotificationDataError('account.deletion-requested', 'caseId must be a UUID');
    }
    return { caseId: data.caseId };
  },
  render: () => ({
    title: 'Account deletion requested',
    body: [
      {
        text: 'An account asked to be deleted. Carry the request out from the administration page: the account’s data is deleted, and relationships that others verified stay as historical records until the legal review.',
      },
    ],
    action: { label: 'See deletion requests', href: '/admin#deletion-requests' },
  }),
  sample: { caseId: '0190a5c0-0000-7000-8000-000000000002' },
};

// --- Teacher requests (M09) ---------------------------------------------------------------------

/**
 * What every relationship notification knows when it is shown. The row stores only the
 * relationship id (and the reason or role it was about); services/notifications.ts adds the rest
 * when the list is read: the other person's current primary name (never a copy kept in the
 * payload, so a renamed profile shows its new name and a removed one none), the lineage and the
 * relationship's current status, so a request answered since no longer offers to answer it.
 */
interface RelationshipNotice {
  relationshipId: string;
  /** Not stored: the other person's display name, null when it can no longer be shown. */
  other: NameData | null;
  /** Not stored: the lineage's name, null when unknown. */
  lineageName: string | null;
  /** Not stored: the relationship's status now. */
  status: string | null;
}

function relationshipNotice(template: string, payload: unknown): RelationshipNotice & { data: Record<string, unknown> } {
  const data = payloadObject(template, payload);
  if (typeof data.relationshipId !== 'string' || !UUID.test(data.relationshipId)) {
    throw new NotificationDataError(template, 'relationshipId must be a UUID');
  }
  const other = data.other === undefined || data.other === null ? null : optionalName(template, data.other);
  return {
    relationshipId: data.relationshipId,
    other,
    lineageName: typeof data.lineageName === 'string' && data.lineageName.length <= 200 ? data.lineageName : null,
    status: typeof data.status === 'string' ? data.status : null,
    data,
  };
}

/** The other person's name as a body segment, or a neutral stand-in. */
const who = (other: NameData | null, fallback: string): NotificationSegment => (other ? { name: other } : { text: fallback });
const inLineage = (lineageName: string | null) => (lineageName ? ` in ${lineageName}` : '');

const STUDENT_QUEUE = '/dashboard/students/requests';
const OWN_TEACHERS = '/dashboard/teachers';

/**
 * "relationship.requested": to the teacher, when a student sends a request or sends it again. While
 * it waits it says when the training started (In scope 2 of M09): `trainingStart` is not stored
 * either, but read from the request's periods when the list is read ("April 2019"), so a corrected
 * request shows its corrected start; null when no start is recorded.
 */
const relationshipRequested: NotificationTemplate<RelationshipNotice & { resubmitted: boolean; trainingStart: string | null }> = {
  name: 'relationship.requested',
  parse(payload) {
    const { data, ...notice } = relationshipNotice('relationship.requested', payload);
    const trainingStart = typeof data.trainingStart === 'string' && data.trainingStart.length > 0 && data.trainingStart.length <= 40 ? data.trainingStart : null;
    return { ...notice, resubmitted: data.resubmitted === true, trainingStart };
  },
  render: ({ other, lineageName, status, resubmitted, trainingStart }) =>
    status === 'pending_teacher' || status === null
      ? {
          title: resubmitted ? 'Teacher request sent again' : 'New teacher request',
          body: [
            who(other, 'A student'),
            {
              text: `${resubmitted ? ' corrected their request and asks again' : ' asks you'} to confirm that you taught them${inLineage(lineageName)}.${
                trainingStart ? ` Training started: ${trainingStart}.` : ''
              }`,
            },
          ],
          action: { label: 'Answer the request', href: STUDENT_QUEUE },
        }
      : {
          title: resubmitted ? 'Teacher request sent again' : 'New teacher request',
          body: [
            who(other, 'A student'),
            {
              text: ` asked you to confirm that you taught them${inLineage(lineageName)}. ${
                status === 'withdrawn' ? 'They have since withdrawn the request.' : 'The request has already been answered.'
              }`,
            },
          ],
        },
  sample: {
    relationshipId: '0190a5c0-0000-7000-8000-000000000003',
    other: { value: 'Demo Student', lang: 'en' },
    lineageName: 'Demo Lineage A',
    status: 'pending_teacher',
    resubmitted: false,
    trainingStart: 'April 2019',
  },
};

/** "relationship.approved": to both people, when the teacher approves (the role says which side reads it). */
const relationshipApproved: NotificationTemplate<RelationshipNotice & { role: 'student' | 'teacher' }> = {
  name: 'relationship.approved',
  parse(payload) {
    const { data, ...notice } = relationshipNotice('relationship.approved', payload);
    if (data.role !== 'student' && data.role !== 'teacher') throw new NotificationDataError('relationship.approved', 'role must be student or teacher');
    return { ...notice, role: data.role };
  },
  render: ({ other, lineageName, role }) =>
    role === 'student'
      ? {
          title: 'Teacher confirmed',
          body: [who(other, 'Your teacher'), { text: ` confirmed that they taught you${inLineage(lineageName)}. The link is now public.` }],
          action: { label: 'See your teachers', href: OWN_TEACHERS },
        }
      : {
          title: 'Student confirmed',
          body: [{ text: 'You confirmed ' }, who(other, 'a student'), { text: ` as your student${inLineage(lineageName)}. The link is now public.` }],
          action: { label: 'See your students', href: STUDENT_QUEUE },
        },
  sample: {
    relationshipId: '0190a5c0-0000-7000-8000-000000000004',
    other: { value: 'Demo Sifu', lang: 'en' },
    lineageName: 'Demo Lineage A',
    status: 'verified',
    role: 'student',
  },
};

/** "relationship.rejected": to the student, with the neutral reason and a link to correct and send again. */
const relationshipRejected: NotificationTemplate<RelationshipNotice & { reason: string }> = {
  name: 'relationship.rejected',
  parse(payload) {
    const { data, ...notice } = relationshipNotice('relationship.rejected', payload);
    return { ...notice, reason: typeof data.reason === 'string' ? data.reason : 'details' };
  },
  render: ({ relationshipId, other, lineageName, status, reason }) => ({
    title: 'Teacher request not confirmed',
    body: [
      who(other, 'Your teacher'),
      { text: ` did not confirm your request${inLineage(lineageName)} as it was sent. Reason: ${rejectionReasonText(reason)}` },
      ...(status === 'rejected' || status === null ? [{ text: ' You can correct it and send it again.' }] : []),
    ],
    ...(status === 'rejected' || status === null
      ? { action: { label: 'Correct and send again', href: `/dashboard/teachers/new?resubmit=${relationshipId}` } }
      : {}),
  }),
  sample: {
    relationshipId: '0190a5c0-0000-7000-8000-000000000005',
    other: { value: 'Demo Sifu', lang: 'en' },
    lineageName: 'Demo Lineage A',
    status: 'rejected',
    reason: 'dates',
  },
};

/** "relationship.ended": to the other person, when the student or the teacher marks the training as ended. */
const relationshipEnded: NotificationTemplate<RelationshipNotice & { by: 'student' | 'teacher' }> = {
  name: 'relationship.ended',
  parse(payload) {
    const { data, ...notice } = relationshipNotice('relationship.ended', payload);
    if (data.by !== 'student' && data.by !== 'teacher') throw new NotificationDataError('relationship.ended', 'by must be student or teacher');
    return { ...notice, by: data.by };
  },
  render: ({ other, lineageName, by }) => ({
    title: 'Training marked as ended',
    body: [
      who(other, by === 'teacher' ? 'Your teacher' : 'Your student'),
      { text: ` marked your training${inLineage(lineageName)} as ended. The link stays on the record as historical.` },
    ],
    action: by === 'teacher' ? { label: 'See your teachers', href: OWN_TEACHERS } : { label: 'See your students', href: STUDENT_QUEUE },
  }),
  sample: {
    relationshipId: '0190a5c0-0000-7000-8000-000000000006',
    other: { value: 'Demo Sifu', lang: 'en' },
    lineageName: 'Demo Lineage A',
    status: 'verified',
    by: 'teacher',
  },
};

// --- Historical teachers and the review queue (M10a) --------------------------------------------

/**
 * "review.decided": to the student of a historical teacher claim, when the reviewers verify it,
 * refuse it or ask for more information. The reviewers' own words are on Your teachers.
 */
const reviewDecided: NotificationTemplate<RelationshipNotice & { decision: 'verified' | 'rejected' | 'needs_info' }> = {
  name: 'review.decided',
  parse(payload) {
    const { data, ...notice } = relationshipNotice('review.decided', payload);
    if (data.decision !== 'verified' && data.decision !== 'rejected' && data.decision !== 'needs_info') {
      throw new NotificationDataError('review.decided', 'decision must be verified, rejected or needs_info');
    }
    return { ...notice, decision: data.decision };
  },
  render: ({ other, lineageName, decision }) =>
    decision === 'verified'
      ? {
          title: 'Historical teacher confirmed',
          body: [{ text: 'The reviewers confirmed from your evidence that ' }, who(other, 'your teacher'), { text: ` taught you${inLineage(lineageName)}. The link is now public.` }],
          action: { label: 'See your teachers', href: OWN_TEACHERS },
        }
      : decision === 'rejected'
        ? {
            title: 'Historical teacher claim not confirmed',
            body: [{ text: 'The reviewers could not confirm your claim about ' }, who(other, 'your teacher'), { text: `${inLineage(lineageName)} from the evidence sent.` }],
            action: { label: 'Read their reason', href: OWN_TEACHERS },
          }
        : {
            title: 'More information needed',
            body: [{ text: 'The reviewers of your claim about ' }, who(other, 'your teacher'), { text: `${inLineage(lineageName)} ask for more information.` }],
            action: { label: 'Read their question', href: OWN_TEACHERS },
          },
  sample: {
    relationshipId: '0190a5c0-0000-7000-8000-000000000007',
    other: { value: 'Demo Historical Teacher', lang: 'en' },
    lineageName: 'Demo Lineage A',
    status: 'verified',
    decision: 'verified',
  },
};

function caseIdOf(template: string, payload: unknown): string {
  const data = payloadObject(template, payload);
  if (typeof data.caseId !== 'string' || !UUID.test(data.caseId)) throw new NotificationDataError(template, 'caseId must be a UUID');
  return data.caseId;
}

/** The kinds of case whose new cases the reviewers are told about (review.opened). */
const OPENED_KINDS = {
  historical_claim: { title: 'New historical teacher claim', body: 'A student sent a claim with evidence. It waits in the review queue.' },
  person_claim: { title: 'New profile claim', body: 'An invited teacher claimed the profile a student started for them. It waits in the review queue.' },
  instructor_verification: { title: 'New instructor verification', body: 'A Sifu sent evidence that they are an instructor. It waits in the review queue.' },
  profile_report: { title: 'New profile report', body: 'A member reported a profile. It waits in the review queue.' },
} as const;
type OpenedKind = keyof typeof OPENED_KINDS;

/**
 * "review.opened": to the reviewers who decide a kind (archivists and administrators for claims
 * and instructor verifications, moderators and administrators for reports), when a case of that
 * kind is opened. No name: the case card shows the people to a session that proved the second
 * factor. Rows written before M10b carry no kind: they are historical claims.
 */
const reviewOpened: NotificationTemplate<{ caseId: string; kind: OpenedKind }> = {
  name: 'review.opened',
  parse(payload) {
    const caseId = caseIdOf('review.opened', payload);
    const kind = payloadObject('review.opened', payload).kind;
    if (kind !== undefined && !Object.hasOwn(OPENED_KINDS, kind as string)) throw new NotificationDataError('review.opened', 'kind must be a kind of case the reviewers open');
    return { caseId, kind: (kind as OpenedKind | undefined) ?? 'historical_claim' };
  },
  render: ({ caseId, kind }) => ({
    title: OPENED_KINDS[kind].title,
    body: [{ text: OPENED_KINDS[kind].body }],
    action: { label: 'Open the case', href: `/admin/review/${caseId}` },
  }),
  sample: { caseId: '0190a5c0-0000-7000-8000-000000000008', kind: 'historical_claim' },
};

/** "review.updated": to the reviewer a case is assigned to, when a party adds evidence or a reply, or withdraws. */
const reviewUpdated: NotificationTemplate<{ caseId: string; change: 'evidence' | 'withdrawn' }> = {
  name: 'review.updated',
  parse(payload) {
    const caseId = caseIdOf('review.updated', payload);
    return { caseId, change: payloadObject('review.updated', payload).change === 'withdrawn' ? 'withdrawn' : 'evidence' };
  },
  render: ({ caseId, change }) => ({
    title: change === 'withdrawn' ? 'Claim withdrawn' : 'New evidence in your case',
    body: [
      {
        text:
          change === 'withdrawn'
            ? 'A claim assigned to you was withdrawn. The case is closed.'
            : 'A party added evidence or an answer to a case assigned to you.',
      },
    ],
    action: { label: 'Open the case', href: `/admin/review/${caseId}` },
  }),
  sample: { caseId: '0190a5c0-0000-7000-8000-000000000009', change: 'evidence' },
};

// --- Schools (M11) -------------------------------------------------------------------------------

/**
 * "school.submitted": to every moderator and administrator when a Sifu sends a school listing for
 * review, and to the assigned reviewer when the Sifu answers their question. No school name: the
 * case card shows it to a session that proved the second factor.
 */
const schoolSubmitted: NotificationTemplate<{ caseId: string }> = {
  name: 'school.submitted',
  parse: (payload) => ({ caseId: caseIdOf('school.submitted', payload) }),
  render: ({ caseId }) => ({
    title: 'School listing to review',
    body: [{ text: 'A Sifu sent a school listing for review. It waits in the review queue.' }],
    action: { label: 'Open the case', href: `/admin/review/${caseId}` },
  }),
  sample: { caseId: '0190a5c0-0000-7000-8000-00000000000a' },
};

/** "school.reviewed": to the Sifu who listed a school, when the reviewers approve it, return it to draft or ask a question. */
const schoolReviewed: NotificationTemplate<{ schoolId: string; decision: 'approved' | 'returned' | 'needs_info' }> = {
  name: 'school.reviewed',
  parse(payload) {
    const data = payloadObject('school.reviewed', payload);
    if (typeof data.schoolId !== 'string' || !UUID.test(data.schoolId)) throw new NotificationDataError('school.reviewed', 'schoolId must be a UUID');
    if (data.decision !== 'approved' && data.decision !== 'returned' && data.decision !== 'needs_info') {
      throw new NotificationDataError('school.reviewed', 'decision must be approved, returned or needs_info');
    }
    return { schoolId: data.schoolId, decision: data.decision };
  },
  render: ({ schoolId, decision }) => {
    const action = { label: decision === 'approved' ? 'See your school' : decision === 'returned' ? 'Read their reason' : 'Read their question', href: `/dashboard/schools/${schoolId}` };
    return decision === 'approved'
      ? { title: 'School listed', body: [{ text: 'The reviewers approved your school listing. Its pin is on the map while your plan includes a public pin.' }], action }
      : decision === 'returned'
        ? { title: 'School listing returned to draft', body: [{ text: 'The reviewers returned your school listing to draft. You can correct it and send it again.' }], action }
        : { title: 'More information needed', body: [{ text: 'The reviewers of your school listing ask for more information.' }], action };
  },
  sample: { schoolId: '0190a5c0-0000-7000-8000-00000000000b', decision: 'approved' },
};

// --- Invitations, profile claims, instructors and arbitration (M10b) -----------------------------

const CASE_PAGE = (caseId: string) => `/dashboard/cases/${caseId}`;

/**
 * "claim.decided": to the teacher who accepted an invitation, when the reviewers approve the
 * profile claim, refuse it or ask for more information, or when the student withdraws the request
 * it answered (closed). The reviewers' words are on the case page.
 */
const claimDecided: NotificationTemplate<{ caseId: string; decision: 'approved' | 'rejected' | 'needs_info' | 'closed' }> = {
  name: 'claim.decided',
  parse(payload) {
    const caseId = caseIdOf('claim.decided', payload);
    const decision = payloadObject('claim.decided', payload).decision;
    if (decision !== 'approved' && decision !== 'rejected' && decision !== 'needs_info' && decision !== 'closed') {
      throw new NotificationDataError('claim.decided', 'decision must be approved, rejected, needs_info or closed');
    }
    return { caseId, decision };
  },
  render: ({ caseId, decision }) =>
    decision === 'approved'
      ? {
          title: 'Profile claim approved',
          body: [{ text: 'The reviewers approved your claim: the profile is now yours. The student who invited you waits for your answer to their request.' }],
          action: { label: 'Answer the request', href: STUDENT_QUEUE },
        }
      : decision === 'rejected'
        ? {
            title: 'Profile claim not approved',
            body: [{ text: 'The reviewers could not confirm that the profile is yours. The profile stays private.' }],
            action: { label: 'Read their reason', href: CASE_PAGE(caseId) },
          }
        : decision === 'needs_info'
          ? {
              title: 'More information needed',
              body: [{ text: 'The reviewers of your profile claim ask for more information.' }],
              action: { label: 'Read their question', href: CASE_PAGE(caseId) },
            }
          : {
              title: 'Profile claim closed',
              body: [{ text: 'The student withdrew the request your claim answered, so the claim is closed. Nothing was published.' }],
              action: { label: 'See the case', href: CASE_PAGE(caseId) },
            },
  sample: { caseId: '0190a5c0-0000-7000-8000-00000000000b', decision: 'approved' },
};

/**
 * "invitation.claimed": to the student who invited a teacher, when the teacher accepts the
 * invitation (claimed), when the reviewers approve the claim (approved: the request now waits for
 * the teacher) or refuse it (refused: the student may invite again).
 */
const invitationClaimed: NotificationTemplate<RelationshipNotice & { stage: 'claimed' | 'approved' | 'refused' }> = {
  name: 'invitation.claimed',
  parse(payload) {
    const { data, ...notice } = relationshipNotice('invitation.claimed', payload);
    if (data.stage !== 'claimed' && data.stage !== 'approved' && data.stage !== 'refused') {
      throw new NotificationDataError('invitation.claimed', 'stage must be claimed, approved or refused');
    }
    return { ...notice, stage: data.stage };
  },
  render: ({ other, lineageName, stage }) =>
    stage === 'claimed'
      ? {
          title: 'Invitation accepted',
          body: [who(other, 'Your teacher'), { text: ` accepted your invitation${inLineage(lineageName)}. A reviewer checks the claim; then they answer your request.` }],
          action: { label: 'See your teachers', href: OWN_TEACHERS },
        }
      : stage === 'approved'
        ? {
            title: 'Teacher joined',
            body: [who(other, 'Your teacher'), { text: ` claimed their profile. Your request${inLineage(lineageName)} now waits for their answer.` }],
            action: { label: 'See your teachers', href: OWN_TEACHERS },
          }
        : {
            title: 'Profile claim not approved',
            body: [{ text: 'The reviewers could not confirm the claim to the profile of ' }, who(other, 'your teacher'), { text: '. You can send the invitation again.' }],
            action: { label: 'See your teachers', href: OWN_TEACHERS },
          },
  sample: {
    relationshipId: '0190a5c0-0000-7000-8000-00000000000c',
    other: { value: 'Demo Invited Sifu', lang: 'en' },
    lineageName: 'Demo Lineage A',
    status: 'awaiting_claim',
    stage: 'claimed',
  },
};

/** "instructor.decided": to a Sifu, when the reviewers verify them as an instructor, refuse or ask for more. */
const instructorDecided: NotificationTemplate<{ caseId: string; decision: 'verified' | 'rejected' | 'needs_info' }> = {
  name: 'instructor.decided',
  parse(payload) {
    const caseId = caseIdOf('instructor.decided', payload);
    const decision = payloadObject('instructor.decided', payload).decision;
    if (decision !== 'verified' && decision !== 'rejected' && decision !== 'needs_info') {
      throw new NotificationDataError('instructor.decided', 'decision must be verified, rejected or needs_info');
    }
    return { caseId, decision };
  },
  render: ({ decision }) => ({
    title: decision === 'verified' ? 'Instructor verified' : decision === 'rejected' ? 'Instructor verification not approved' : 'More information needed',
    body: [
      {
        text:
          decision === 'verified'
            ? 'The reviewers verified you as an instructor. Your profile now says “Instructor”.'
            : decision === 'rejected'
              ? 'The reviewers could not verify you as an instructor from the evidence sent. You can send new evidence.'
              : 'The reviewers of your instructor verification ask for more information.',
      },
    ],
    action: { label: decision === 'needs_info' ? 'Read their question' : 'See your instructor status', href: '/dashboard/instructor' },
  }),
  sample: { caseId: '0190a5c0-0000-7000-8000-00000000000d', decision: 'verified' },
};

const ARBITRATION_STAGES = ['opened', 'needs_info', 'kept', 'revoked'] as const;

/**
 * "relationship.arbitration": to both people of a relationship in arbitration (DEFAULT D19): when a
 * moderator sets it, asks for more, or decides. It shows the moderator's words and links to the
 * case page, where each party sends evidence.
 */
const relationshipArbitration: NotificationTemplate<RelationshipNotice & { caseId: string; stage: (typeof ARBITRATION_STAGES)[number]; reason: string }> = {
  name: 'relationship.arbitration',
  parse(payload) {
    const { data, ...notice } = relationshipNotice('relationship.arbitration', payload);
    const caseId = caseIdOf('relationship.arbitration', payload);
    if (!(ARBITRATION_STAGES as readonly unknown[]).includes(data.stage)) throw new NotificationDataError('relationship.arbitration', 'stage must be opened, needs_info, kept or revoked');
    if (typeof data.reason !== 'string' || data.reason.trim() === '' || data.reason.length > 2000) {
      throw new NotificationDataError('relationship.arbitration', 'reason must be a text of 1 to 2000 characters');
    }
    return { ...notice, caseId, stage: data.stage as (typeof ARBITRATION_STAGES)[number], reason: data.reason.trim() };
  },
  render: ({ other, lineageName, caseId, stage, reason }) => {
    const relation: NotificationSegment[] = [{ text: 'your relationship with ' }, who(other, 'the other person'), { text: inLineage(lineageName) }];
    return stage === 'opened'
      ? {
          title: 'Relationship in arbitration',
          body: [{ text: 'A moderator set ' }, ...relation, { text: ` in arbitration. Public pages show it as “Disputed”. Reason: ${reason}` }],
          action: { label: 'Send evidence', href: CASE_PAGE(caseId) },
        }
      : stage === 'needs_info'
        ? {
            title: 'More information needed',
            body: [{ text: 'The moderators handling ' }, ...relation, { text: ` ask for more information: ${reason}` }],
            action: { label: 'Send evidence', href: CASE_PAGE(caseId) },
          }
        : {
            title: stage === 'kept' ? 'Arbitration decided: the link stands' : 'Arbitration decided: the link is revoked',
            body: [
              { text: 'The moderators decided ' },
              ...relation,
              { text: stage === 'kept' ? `: it stands and is verified again. Reason: ${reason}` : `: it is revoked and leaves the public lineage. Reason: ${reason}` },
            ],
            action: { label: 'See the case', href: CASE_PAGE(caseId) },
          };
  },
  sample: {
    relationshipId: '0190a5c0-0000-7000-8000-00000000000e',
    other: { value: 'Demo Sifu', lang: 'en' },
    lineageName: 'Demo Lineage A',
    status: 'in_arbitration',
    caseId: '0190a5c0-0000-7000-8000-00000000000f',
    stage: 'opened',
    reason: 'Another member says the training dates are not right. Please send what shows when the training took place.',
  },
};

/** The templates whose payload names a relationship (services/notifications.ts enriches them). */
export const RELATIONSHIP_NOTIFICATIONS = [
  'relationship.requested',
  'relationship.approved',
  'relationship.rejected',
  'relationship.ended',
  'review.decided',
  'invitation.claimed',
  'relationship.arbitration',
] as const;

/** Every notification template, by name (= template.name). */
export const NOTIFICATION_TEMPLATES = {
  'mail-check.sent': mailCheckSent,
  'account.deletion-requested': accountDeletionRequested,
  'pilot-access.requested': pilotAccessRequested,
  'pilot-access.closed': pilotAccessClosed,
  'plan.granted': planGranted,
  'plan.revoked': planRevoked,
  'relationship.requested': relationshipRequested,
  'relationship.approved': relationshipApproved,
  'relationship.rejected': relationshipRejected,
  'relationship.ended': relationshipEnded,
  'review.decided': reviewDecided,
  'review.opened': reviewOpened,
  'review.updated': reviewUpdated,
  'school.submitted': schoolSubmitted,
  'school.reviewed': schoolReviewed,
  'claim.decided': claimDecided,
  'invitation.claimed': invitationClaimed,
  'instructor.decided': instructorDecided,
  'relationship.arbitration': relationshipArbitration,
} as const;

export type NotificationTemplateName = keyof typeof NOTIFICATION_TEMPLATES;

export function isNotificationTemplateName(name: string): name is NotificationTemplateName {
  return Object.hasOwn(NOTIFICATION_TEMPLATES, name);
}

/** Renders a stored notification. Throws NotificationDataError for an unknown template or bad payload. */
export function renderNotification(template: string, payload: unknown, context: NotificationContext = {}): RenderedNotification {
  if (!isNotificationTemplateName(template)) throw new NotificationDataError(template, 'unknown template');
  const definition = NOTIFICATION_TEMPLATES[template] as NotificationTemplate<unknown>;
  return definition.render(definition.parse(payload), context);
}
