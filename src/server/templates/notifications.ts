// The texts of dashboard notifications (plan §6.1, §6.2; milestone M01b, In scope 3). English
// only, and the only place with notification text: a `notification` row stores a template name
// and a payload, and the dashboard (M08) renders it through renderNotification().
//
// A body is a list of segments rather than one string, so that a person's name keeps its `lang`
// attribute and translate="no" when the dashboard renders it (plan §5.3).

import { formatDay, untilPlanEnd } from '../../lib/dates';
import { PLAN_CODES } from '../db/schema/common';
import { feature, type FeatureKey, GRANTABLE_PLANS, type PlanCode, PLANS, upgradeBenefits } from '../entitlements/plans';
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
const SEE_YOUR_BILLING = { label: 'Open billing', href: '/dashboard/billing' } as const;

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
  // M15.
  organization_application: { title: 'New organization application', body: 'An organization applied to be listed. It waits in the review queue.' },
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

// --- Organizations (M15) -------------------------------------------------------------------------

function uuidOf(template: string, key: string, payload: unknown): string {
  const value = payloadObject(template, payload)[key];
  if (typeof value !== 'string' || !UUID.test(value)) throw new NotificationDataError(template, `${key} must be a UUID`);
  return value;
}

const ORGANIZATION_PAGE = (organizationId: string) => `/dashboard/organization/${organizationId}`;

/**
 * "organization.reviewed": to the admins of an organization when the reviewers approve its
 * application, decline it or ask for more information. Approval lists the organization; it is not
 * a plan and verifies nobody (DEFAULT D04).
 */
const organizationReviewed: NotificationTemplate<{ organizationId: string; decision: 'approved' | 'declined' | 'needs_info' }> = {
  name: 'organization.reviewed',
  parse(payload) {
    const organizationId = uuidOf('organization.reviewed', 'organizationId', payload);
    const decision = payloadObject('organization.reviewed', payload).decision;
    if (decision !== 'approved' && decision !== 'declined' && decision !== 'needs_info') {
      throw new NotificationDataError('organization.reviewed', 'decision must be approved, declined or needs_info');
    }
    return { organizationId, decision };
  },
  render: ({ organizationId, decision }) => {
    const action = { label: decision === 'approved' ? 'Open your organization' : decision === 'declined' ? 'Read their reason' : 'Read their question', href: ORGANIZATION_PAGE(organizationId) };
    return decision === 'approved'
      ? { title: 'Organization approved', body: [{ text: 'The reviewers approved your organization’s application. Its public page is online. Approval is not a plan and verifies no teacher or relationship.' }], action }
      : decision === 'declined'
        ? { title: 'Organization application declined', body: [{ text: 'The reviewers declined your organization’s application. Their reason is on its page.' }], action }
        : { title: 'More information needed', body: [{ text: 'The reviewers of your organization’s application ask for more information.' }], action };
  },
  sample: { organizationId: '0190a5c0-0000-7000-8000-00000000000c', decision: 'approved' },
};

/** "organization.admin_added": to an account an organization's owner made one of its admins. */
const organizationAdminAdded: NotificationTemplate<{ organizationId: string }> = {
  name: 'organization.admin_added',
  parse: (payload) => ({ organizationId: uuidOf('organization.admin_added', 'organizationId', payload) }),
  render: ({ organizationId }) => ({
    title: 'You administer an organization',
    body: [{ text: 'An owner of an organization added you as one of its admins. You can manage its details from your dashboard.' }],
    action: { label: 'Open the organization', href: ORGANIZATION_PAGE(organizationId) },
  }),
  sample: { organizationId: '0190a5c0-0000-7000-8000-00000000000d' },
};

/** "organization.school_requested": to the account that listed a school, when an organization asks to link it. */
const organizationSchoolRequested: NotificationTemplate<{ linkId: string }> = {
  name: 'organization.school_requested',
  parse: (payload) => ({ linkId: uuidOf('organization.school_requested', 'linkId', payload) }),
  render: () => ({
    title: 'An organization asks to link your school',
    body: [{ text: 'An organization asks to list your school among its schools. Nothing changes until you accept; your school and its pin stay as they are either way.' }],
    action: { label: 'Answer the request', href: '/dashboard/schools#organizations' },
  }),
  sample: { linkId: '0190a5c0-0000-7000-8000-00000000000e' },
};

/** "organization.school_answered": to the admins of an organization, when a school accepts, refuses or ends a link. */
const organizationSchoolAnswered: NotificationTemplate<{ organizationId: string; decision: 'accepted' | 'refused' | 'ended' }> = {
  name: 'organization.school_answered',
  parse(payload) {
    const organizationId = uuidOf('organization.school_answered', 'organizationId', payload);
    const decision = payloadObject('organization.school_answered', payload).decision;
    if (decision !== 'accepted' && decision !== 'refused' && decision !== 'ended') {
      throw new NotificationDataError('organization.school_answered', 'decision must be accepted, refused or ended');
    }
    return { organizationId, decision };
  },
  render: ({ organizationId, decision }) => ({
    title: decision === 'accepted' ? 'A school accepted the link' : decision === 'refused' ? 'A school refused the link' : 'A school ended the link',
    body: [
      {
        text:
          decision === 'accepted'
            ? 'A school accepted your organization’s request: it is listed on your organization’s page now.'
            : decision === 'refused'
              ? 'A school refused your organization’s request. Nothing changed.'
              : 'A school ended its link with your organization. It is no longer listed on your organization’s page.',
      },
    ],
    action: { label: 'Open the organization', href: ORGANIZATION_PAGE(organizationId) },
  }),
  sample: { organizationId: '0190a5c0-0000-7000-8000-00000000000f', decision: 'accepted' },
};

/** "organization.member_left" (M24): to the admins of an organization, when a member ends their own membership. */
const organizationMemberLeft: NotificationTemplate<{ organizationId: string }> = {
  name: 'organization.member_left',
  parse: (payload) => ({ organizationId: uuidOf('organization.member_left', 'organizationId', payload) }),
  render: ({ organizationId }) => ({
    title: 'A member left the organization',
    body: [
      {
        text: 'A member ended their membership of your organization. It stays in the organization’s history; the organization’s rank and city for them and its teacher claims about them were removed. Their teachers and students did not change.',
      },
    ],
    action: { label: 'Open the organization', href: ORGANIZATION_PAGE(organizationId) },
  }),
  sample: { organizationId: '0190a5c0-0000-7000-8000-000000000024' },
};

/** "organization.membership_ended" (M24): to the account of a person whose membership an organization ended. */
const organizationMembershipEnded: NotificationTemplate<{ organizationId: string }> = {
  name: 'organization.membership_ended',
  parse: (payload) => ({ organizationId: uuidOf('organization.membership_ended', 'organizationId', payload) }),
  render: () => ({
    title: 'An organization ended your membership',
    body: [
      {
        text: 'An organization ended your membership. It stays in the organization’s history. Your teachers, your students and your profile did not change, and the organization’s rank and claims about you were removed.',
      },
    ],
    action: { label: 'See your memberships', href: '/dashboard/organization#memberships' },
  }),
  sample: { organizationId: '0190a5c0-0000-7000-8000-000000000025' },
};

// --- Events (M17) --------------------------------------------------------------------------------

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface EventNoticeData {
  eventId: string;
  slug: string;
  title: string;
  /** The first day in the event's own zone, YYYY-MM-DD. */
  startDay: string;
}

function eventNotice(template: string, payload: unknown): EventNoticeData {
  const eventId = uuidOf(template, 'eventId', payload);
  const { slug, title, startDay } = payloadObject(template, payload);
  if (typeof slug !== 'string' || slug.length > 200 || !EVENT_SLUG.test(slug)) throw new NotificationDataError(template, 'slug must be an event slug');
  if (typeof title !== 'string' || title.length < 1 || title.length > 200) throw new NotificationDataError(template, 'title must be a short text');
  if (typeof startDay !== 'string' || !DAY_KEY.test(startDay)) throw new NotificationDataError(template, 'startDay must be YYYY-MM-DD');
  return { eventId, slug, title, startDay };
}

function eventDay(startDay: string): string {
  const [year, month, day] = startDay.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * "event.published" (DEFAULT M17, question 3): to a Premium Student whose established teacher
 * organizes or teaches at an event that was just published.
 */
const eventPublished: NotificationTemplate<EventNoticeData> = {
  name: 'event.published',
  parse: (payload) => eventNotice('event.published', payload),
  render: ({ slug, title, startDay }) => ({
    title: 'A teacher of yours has a new event',
    body: [{ text: `“${title}” starts on ${eventDay(startDay)}. One of your teachers organizes it or teaches at it.` }],
    action: { label: 'Open the event', href: `/events/${slug}` },
  }),
  sample: { eventId: '0190a5c0-0000-7000-8000-0000000000e1', slug: 'demo-seminar-sofia', title: 'Demo seminar in Sofia', startDay: '2027-03-13' },
};

/** "event.cancelled" (DEFAULT M17, question 3): the same students, when the organizer cancels it. */
const eventCancelled: NotificationTemplate<EventNoticeData> = {
  name: 'event.cancelled',
  parse: (payload) => eventNotice('event.cancelled', payload),
  render: ({ slug, title, startDay }) => ({
    title: 'An event was cancelled',
    body: [{ text: `“${title}”, planned for ${eventDay(startDay)}, was cancelled by its organizer.` }],
    action: { label: 'Open the event', href: `/events/${slug}` },
  }),
  sample: { eventId: '0190a5c0-0000-7000-8000-0000000000e2', slug: 'demo-camp-plovdiv', title: 'Demo summer camp', startDay: '2027-07-01' },
};

// --- Lifecycle notices (M18; docs/adr/0021-notices.md) -------------------------------------------
//
// Security notices are e-mailed always and never switched off (In scope 5). They say what changed
// and what to do if it was not you; never an IP address, a place or a device (plan §6.4).

const SECURITY_PAGE = { label: 'Open Security', href: '/account/security' } as const;
const NOT_YOU = 'If this was not you, reset your password from the sign-in page and check your two-factor authentication.';

function emptyPayload(template: string, payload: unknown): Record<string, never> {
  if (payload !== undefined && payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
    throw new NotificationDataError(template, 'payload must be an object');
  }
  return {};
}

function securityNotice(name: string, title: string, text: string): NotificationTemplate<Record<string, never>> {
  return {
    name,
    parse: (payload) => emptyPayload(name, payload),
    render: () => ({ title, body: [{ text: `${text} ${NOT_YOU}` }], action: SECURITY_PAGE }),
    sample: {},
  };
}

/** "security.password-changed": the password was changed (Security) or reset through the e-mailed link. */
const securityPasswordChanged = securityNotice(
  'security.password-changed',
  'Your password was changed',
  'The password of your WingChunRoots account was changed.',
);
/** "security.two-factor-enabled": two-factor authentication was turned on. */
const securityTwoFactorEnabled = securityNotice(
  'security.two-factor-enabled',
  'Two-factor authentication turned on',
  'Two-factor authentication is now on for your account: signing in asks for a code from your authenticator app.',
);
/** "security.two-factor-disabled": two-factor authentication was turned off. */
const securityTwoFactorDisabled = securityNotice(
  'security.two-factor-disabled',
  'Two-factor authentication turned off',
  'Two-factor authentication is now off for your account: signing in asks only for your password.',
);
/** "security.backup-codes": new backup codes replaced the old ones. */
const securityBackupCodes = securityNotice(
  'security.backup-codes',
  'New backup codes',
  'New backup codes were made for your account. The earlier codes no longer work.',
);

/**
 * "security.email-changed": the account's e-mail address changed, to the new address and to the
 * old one (`side`). No address in the text: the old address reads that it no longer signs in.
 */
const securityEmailChanged: NotificationTemplate<{ side: 'old' | 'new' }> = {
  name: 'security.email-changed',
  parse(payload) {
    const side = payloadObject('security.email-changed', payload).side;
    if (side !== 'old' && side !== 'new') throw new NotificationDataError('security.email-changed', 'side must be old or new');
    return { side };
  },
  render: ({ side }) => ({
    title: 'E-mail address changed',
    body: [
      {
        text:
          side === 'new'
            ? `This is now the e-mail address of your WingChunRoots account. ${NOT_YOU}`
            : `The e-mail address of your WingChunRoots account was changed, and this address no longer signs in. ${NOT_YOU}`,
      },
    ],
    action: SECURITY_PAGE,
  }),
  sample: { side: 'new' },
};

function anyPlan(template: string, key: string, value: unknown): PlanCode {
  if (typeof value !== 'string' || !(PLAN_CODES as readonly string[]).includes(value)) throw new NotificationDataError(template, `${key} must be a plan`);
  return value as PlanCode;
}

function requiredDate(template: string, key: string, value: unknown): string {
  const date = optionalDate(template, key, value);
  if (date === null) throw new NotificationDataError(template, `${key} must be a date`);
  return date;
}

interface PlanEndNotice {
  grantId: string;
  planCode: PlanCode;
  endsAt: string;
  /** The free plan the account has after the end (its account type when the job ran). */
  nextPlanCode: PlanCode;
  /** M22: a paid subscription (test mode) cancelled at its period end, not a pilot grant. */
  paid?: boolean;
}

function planEndNotice(template: string, payload: unknown): PlanEndNotice {
  const data = payloadObject(template, payload);
  return {
    grantId: uuidOf(template, 'grantId', payload),
    planCode: grantablePlan(template, data.planCode),
    endsAt: requiredDate(template, 'endsAt', data.endsAt),
    nextPlanCode: anyPlan(template, 'nextPlanCode', data.nextPlanCode),
    ...(data.paid === true ? { paid: true } : {}),
  };
}

/** What stays after a plan ends (D06, D08): said the same way before and after the end. */
function whatStays(planCode: PlanCode, next: PlanCode): string {
  return PLANS[planCode].audience === 'sifu'
    ? `Every confirmed link stays confirmed and public, and nothing you added is deleted: your schools stay listed and your photos and events stay. New approvals, photos and events follow the limits of ${PLANS[next].name}.`
    : `Your profile, your photos and every confirmed link stay as they are. New photos follow the limits of ${PLANS[next].name}.`;
}

/**
 * "plan.expiring" (M18, In scope 5): once per grant, when the daily job finds that it ends within 7
 * days. The date and what stays; never a countdown (CLAUDE.md §11).
 */
const planExpiring: NotificationTemplate<PlanEndNotice> = {
  name: 'plan.expiring',
  parse: (payload) => planEndNotice('plan.expiring', payload),
  render: ({ planCode, endsAt, nextPlanCode, paid }) =>
    paid
      ? {
          title: `Your plan has an end date: ${PLANS[planCode].name}`,
          body: [{ text: `You cancelled ${PLANS[planCode].name}, so it does not renew. It runs until ${formatDay(endsAt)}. After that your account has ${PLANS[nextPlanCode].name}. ${whatStays(planCode, nextPlanCode)} You can resume it before then.` }],
          action: SEE_YOUR_BILLING,
        }
      : {
          title: `Your pilot plan has an end date: ${PLANS[planCode].name}`,
          body: [{ text: `Your pilot plan ${PLANS[planCode].name} runs ${untilPlanEnd(endsAt)}. After that your account has ${PLANS[nextPlanCode].name}. ${whatStays(planCode, nextPlanCode)}` }],
          action: SEE_YOUR_PLAN,
        },
  sample: { grantId: '0190a5c0-0000-7000-8000-0000000000f1', planCode: 'pro_sifu', endsAt: '2027-01-01T00:00:00.000Z', nextPlanCode: 'free_sifu' },
};

/** "plan.expired" (M18, In scope 5): once per grant, after its end. */
const planExpired: NotificationTemplate<PlanEndNotice> = {
  name: 'plan.expired',
  parse: (payload) => planEndNotice('plan.expired', payload),
  render: ({ planCode, endsAt, nextPlanCode, paid }) =>
    paid
      ? {
          title: `Plan ended: ${PLANS[planCode].name}`,
          body: [{ text: `Your cancelled plan ${PLANS[planCode].name} ran until ${formatDay(endsAt)}. Your account now has ${PLANS[nextPlanCode].name}. ${whatStays(planCode, nextPlanCode)}` }],
          action: SEE_YOUR_BILLING,
        }
      : {
          title: `Pilot plan ended: ${PLANS[planCode].name}`,
          body: [{ text: `Your pilot plan ${PLANS[planCode].name} ran ${untilPlanEnd(endsAt)}. Your account now has ${PLANS[nextPlanCode].name}. ${whatStays(planCode, nextPlanCode)}` }],
          action: SEE_YOUR_PLAN,
        },
  sample: { grantId: '0190a5c0-0000-7000-8000-0000000000f2', planCode: 'premium_student', endsAt: '2027-01-01T00:00:00.000Z', nextPlanCode: 'free_student' },
};

/** The features whose limit sends a notice (DEFAULT M18, question 2): students (D06), photos (D07), events (M17). */
export const LIMIT_FEATURES = ['approve_students', 'photos', 'events'] as const satisfies readonly FeatureKey[];
export type LimitFeature = (typeof LIMIT_FEATURES)[number];
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

interface LimitReached {
  feature: LimitFeature;
  planCode: PlanCode;
  limit: number;
  /** The lowest plan that allows more (the upgrade prompt of M08), or null when none does. */
  upgradeTo: PlanCode | null;
  /** The month (UTC) of the notice: one per feature and month. */
  month: string;
}

/**
 * "limit.reached" (DEFAULT M18, question 2): in the dashboard only, once per feature and month,
 * when an action meets a real limit of the plan (a quota, never a feature the plan lacks). The
 * prompt of M08: only benefits with availability 'now' (upgradeBenefits), led by the one that was
 * hit, and how to ask for pilot access; nothing is charged, and nothing presses for time (CLAUDE.md §11).
 */
const limitReached: NotificationTemplate<LimitReached> = {
  name: 'limit.reached',
  parse(payload) {
    const data = payloadObject('limit.reached', payload);
    if (typeof data.feature !== 'string' || !(LIMIT_FEATURES as readonly string[]).includes(data.feature)) {
      throw new NotificationDataError('limit.reached', 'feature must be one with a limit');
    }
    if (typeof data.limit !== 'number' || !Number.isInteger(data.limit) || data.limit < 0) throw new NotificationDataError('limit.reached', 'limit must be a whole number');
    if (typeof data.month !== 'string' || !MONTH_KEY.test(data.month)) throw new NotificationDataError('limit.reached', 'month must be YYYY-MM');
    return {
      feature: data.feature as LimitFeature,
      planCode: anyPlan('limit.reached', 'planCode', data.planCode),
      limit: data.limit,
      upgradeTo: data.upgradeTo === null || data.upgradeTo === undefined ? null : anyPlan('limit.reached', 'upgradeTo', data.upgradeTo),
      month: data.month,
    };
  },
  render: ({ feature: key, planCode, upgradeTo }) => {
    const f = feature(key);
    const own = f.values[planCode].label;
    const benefits = upgradeTo ? upgradeBenefits(planCode, upgradeTo, key) : [];
    const offer =
      upgradeTo && benefits.length > 0
        ? ` ${PLANS[upgradeTo].name} gives ${benefits.map((b) => `${b.label}: ${b.to}`).join('; ')}. During the pilot you can ask an administrator for it; nothing is charged.`
        : '';
    return {
      title: `Plan limit reached: ${f.label}`,
      body: [{ text: `${PLANS[planCode].name} includes ${own.charAt(0).toLowerCase()}${own.slice(1)}, and that limit is reached. Nothing you already have changes.${offer}` }],
      action: upgradeTo ? { label: 'Compare plans', href: '/plans' } : SEE_YOUR_PLAN,
    };
  },
  sample: { feature: 'events', planCode: 'pro_sifu', limit: 2, upgradeTo: null, month: '2027-03' },
};

/**
 * What staff can remove with a reason (M18, In scope 5): an event, a profile or gallery photo, a
 * school's photo; M19: an entry of a training passport.
 */
export const REMOVED_CONTENT = ['event', 'photo', 'school_photo', 'passport_entry'] as const;
type RemovedContent = (typeof REMOVED_CONTENT)[number];
const REMOVED_LABEL: Record<RemovedContent, { what: string; action: { label: string; href: string } }> = {
  event: { what: 'One of your events', action: { label: 'See your events', href: '/dashboard/events' } },
  photo: { what: 'One of your photos', action: { label: 'See your photos', href: '/dashboard/photos' } },
  school_photo: { what: 'A photo of your school', action: { label: 'See your schools', href: '/dashboard/schools' } },
  passport_entry: { what: 'An entry of your training passport', action: { label: 'Open your passport', href: '/dashboard/passport' } },
};

/**
 * "content.removed" (M18, In scope 5): to the owner, when staff with a verified second factor
 * remove their content with a reason. The reason is the staff's words to the owner; no name of
 * the staff member. A statement of reasons is never switched off (category `account`).
 */
const contentRemoved: NotificationTemplate<{ content: RemovedContent; reason: string; title: string | null }> = {
  name: 'content.removed',
  parse(payload) {
    const data = payloadObject('content.removed', payload);
    if (typeof data.content !== 'string' || !(REMOVED_CONTENT as readonly string[]).includes(data.content)) {
      throw new NotificationDataError('content.removed', 'content must be an event or a photo');
    }
    if (typeof data.reason !== 'string' || data.reason.trim() === '' || data.reason.length > 1000) throw new NotificationDataError('content.removed', 'reason must be a text');
    const title = typeof data.title === 'string' && data.title.trim() !== '' && data.title.length <= 200 ? data.title.trim() : null;
    return { content: data.content as RemovedContent, reason: data.reason.trim(), title };
  },
  render: ({ content, reason, title }) => ({
    title: 'Removed by the moderators',
    body: [
      {
        text: `${content === 'event' && title ? `Your event “${title}”` : REMOVED_LABEL[content].what} was removed by the WingChunRoots moderators. Their reason: “${reason}”`,
      },
    ],
    action: REMOVED_LABEL[content].action,
  }),
  sample: { content: 'event', reason: 'The date and the place do not match the poster.', title: 'Demo seminar in Sofia' },
};

// --- Training passport (M19; docs/adr/0022-passport.md) ---------------------------------------------

/** The kinds of entry a teacher writes (M19, In scope 2); a certificate is the student's own. */
export const PASSPORT_WRITTEN_KINDS = ['rank', 'exam', 'skill', 'attendance'] as const;
type PassportWrittenKind = (typeof PASSPORT_WRITTEN_KINDS)[number];
const PASSPORT_KIND_WORDS: Record<PassportWrittenKind, string> = {
  rank: 'a rank',
  exam: 'an examination',
  skill: 'a form or skill',
  attendance: 'your attendance at an event',
};

interface PassportNoticeData {
  kind: PassportWrittenKind;
  /** The rank, the awarded rank, the form or skill, or the event's title, as written. */
  title: string;
}

function passportNotice(template: string, payload: unknown): PassportNoticeData {
  const { kind, title } = payloadObject(template, payload);
  if (typeof kind !== 'string' || !(PASSPORT_WRITTEN_KINDS as readonly string[]).includes(kind)) throw new NotificationDataError(template, 'kind must be a kind of passport entry');
  if (typeof title !== 'string' || title.trim() === '' || title.length > 200) throw new NotificationDataError(template, 'title must be a short text');
  return { kind: kind as PassportWrittenKind, title: title.trim() };
}

/**
 * "passport.entry-added" (M19, In scope 2): to the student, when a teacher or an organization's
 * admin records a rank, an examination, a form or skill, or attendance at an event. The student
 * decides whether it is public.
 */
const passportEntryAdded: NotificationTemplate<PassportNoticeData> = {
  name: 'passport.entry-added',
  parse: (payload) => passportNotice('passport.entry-added', payload),
  render: ({ kind, title }) => ({
    title: 'New in your training passport',
    // A teacher or an organization's admin: the notice names neither, so it is right for both.
    body: [{ text: `Your teacher or organization recorded ${PASSPORT_KIND_WORDS[kind]}: “${title}”. You choose whether it shows on your profile.` }],
    action: { label: 'Open your passport', href: '/dashboard/passport' },
  }),
  sample: { kind: 'rank', title: 'Demo second level' },
};

/**
 * "passport.correction" (M19, In scope 2): to whoever wrote an entry, when the student proposes a
 * correction. The proposal itself is read in the dashboard, never in the notice or its e-mail.
 */
const passportCorrection: NotificationTemplate<PassportNoticeData> = {
  name: 'passport.correction',
  parse: (payload) => passportNotice('passport.correction', payload),
  render: ({ kind, title }) => ({
    title: 'A student proposes a correction',
    body: [{ text: `A student of yours proposes a correction to ${PASSPORT_KIND_WORDS[kind]} you recorded: “${title}”.` }],
    action: { label: 'Open your students', href: '/dashboard/students' },
  }),
  sample: { kind: 'exam', title: 'Demo first level' },
};

// --- School activity checks (M20; docs/adr/0023-school-activity.md) -------------------------------

/** What a school activity notice carries: the school by id and name, and its dates (no point, no contact). */
interface SchoolActivityNotice {
  schoolId: string;
  /** The school's name as listed (any script; quoted in the text). */
  name: string;
  /** When its listing account last edited or confirmed it. */
  lastActivityAt: string;
  /**
   * Whether the public saw it on the map when the notice was written. False for a listing whose
   * account lacks Professional Sifu (DEFAULT D18): it is never told that it leaves the map. A
   * payload without it is read as true.
   */
  onMap: boolean;
}

function schoolActivityNotice(template: string, payload: unknown): SchoolActivityNotice {
  const data = payloadObject(template, payload);
  if (typeof data.name !== 'string' || data.name.trim() === '' || data.name.length > 200) throw new NotificationDataError(template, 'name must be a short text');
  if (data.onMap !== undefined && typeof data.onMap !== 'boolean') throw new NotificationDataError(template, 'onMap must be true or false');
  return {
    schoolId: uuidOf(template, 'schoolId', payload),
    name: data.name.trim(),
    lastActivityAt: requiredDate(template, 'lastActivityAt', data.lastActivityAt),
    onMap: data.onMap !== false,
  };
}

/**
 * "school.activity-awaiting" (M20; specification §7.3, DEFAULT D17): once per school and period
 * without activity, when the daily job finds that its listing account has not edited or confirmed
 * it for 90 days. To that account, which can confirm it, and to the admins of the organizations the
 * school accepted a link from (`organizationId`), who are told only. A calm request with the date by
 * which to answer; never a countdown, a warning sign or blame (CLAUDE.md §11).
 */
const schoolActivityAwaiting: NotificationTemplate<SchoolActivityNotice & { confirmBy: string; organizationId: string | null }> = {
  name: 'school.activity-awaiting',
  parse(payload) {
    const data = payloadObject('school.activity-awaiting', payload);
    return {
      ...schoolActivityNotice('school.activity-awaiting', payload),
      confirmBy: requiredDate('school.activity-awaiting', 'confirmBy', data.confirmBy),
      organizationId: data.organizationId === undefined || data.organizationId === null ? null : uuidOf('school.activity-awaiting', 'organizationId', payload),
    };
  },
  render: ({ schoolId, name, lastActivityAt, confirmBy, organizationId, onMap }) =>
    organizationId
      ? {
          title: 'A school of your organization: listing to confirm',
          body: [
            {
              text: `The listing of “${name}” was last edited or confirmed on ${formatDay(lastActivityAt)}. Its Sifu has been asked to confirm that it is current. You do not need to do anything; if it is not confirmed by about ${formatDay(confirmBy)}, it is no longer shown on the public map and list until its Sifu confirms it. Nothing is deleted.`,
            },
          ],
          action: { label: 'See your organization', href: ORGANIZATION_PAGE(organizationId) },
        }
      : {
          title: 'Is your school listing still current?',
          body: [
            {
              text: onMap
                ? `The listing of “${name}” was last edited or confirmed on ${formatDay(lastActivityAt)}. If the school still trains, press “This listing is current” on its page, or change its details. If it is not confirmed by about ${formatDay(confirmBy)}, it is no longer shown on the public map and list until you confirm it. Nothing is deleted, and signing in alone does not count as a confirmation.`
                : `The listing of “${name}” was last edited or confirmed on ${formatDay(lastActivityAt)}. If the school still trains, press “This listing is current” on its page, or change its details. It is not on the public map now, because a public pin needs Professional Sifu; your confirmation is recorded either way. Nothing is deleted, and signing in alone does not count as a confirmation.`,
            },
          ],
          action: { label: 'Confirm the listing', href: `/dashboard/schools/${schoolId}` },
        },
  sample: { schoolId: '0190a5c0-0000-7000-8000-0000000000c1', name: 'Demo Wing Chun Hall', lastActivityAt: '2026-08-03T09:00:00.000Z', confirmBy: '2026-11-16T09:00:00.000Z', organizationId: null, onMap: true },
};

/**
 * "school.activity-hidden" (M20; specification §7.3, DEFAULT D17, D18): once per school and period
 * without activity, to its listing account, when the daily job takes the pin and the listing off
 * the public map and list on day 105. What happened, that nothing is deleted and how to show it again.
 */
const schoolActivityHidden: NotificationTemplate<SchoolActivityNotice> = {
  name: 'school.activity-hidden',
  parse: (payload) => schoolActivityNotice('school.activity-hidden', payload),
  render: ({ schoolId, name, lastActivityAt, onMap }) =>
    onMap
      ? {
          title: 'Your school listing is not shown for now',
          body: [
            {
              text: `The listing of “${name}” was last edited or confirmed on ${formatDay(lastActivityAt)}, so it is no longer shown on the public map and list. Nothing is deleted. To show it again, press “This listing is current” on its page, or change its details; the pin returns while your plan includes a public pin.`,
            },
          ],
          action: { label: 'Show it again', href: `/dashboard/schools/${schoolId}` },
        }
      : {
          title: 'Your school listing is marked as not current',
          body: [
            {
              text: `The listing of “${name}” was last edited or confirmed on ${formatDay(lastActivityAt)}, so it is marked as not current. It was not on the public map, because a public pin needs Professional Sifu. Nothing is deleted. To mark it current, press “This listing is current” on its page, or change its details.`,
            },
          ],
          action: { label: 'Confirm the listing', href: `/dashboard/schools/${schoolId}` },
        },
  sample: { schoolId: '0190a5c0-0000-7000-8000-0000000000c2', name: 'Demo Wing Chun Hall', lastActivityAt: '2026-07-01T09:00:00.000Z', onMap: true },
};

// --- Trial lessons (M21; docs/adr/0024-trial-lessons.md) ------------------------------------------

/** What a trial lesson notice carries: the school by id, slug and name, the inquiry by id. No sender, no contact. */
interface TrialNotice {
  schoolId: string;
  inquiryId: string;
  /** The school's name as listed (any script; quoted in the text). */
  name: string;
}

function trialNotice(template: string, payload: unknown): TrialNotice {
  const data = payloadObject(template, payload);
  if (typeof data.name !== 'string' || data.name.trim() === '' || data.name.length > 200) throw new NotificationDataError(template, 'name must be a short text');
  return { schoolId: uuidOf(template, 'schoolId', payload), inquiryId: uuidOf(template, 'inquiryId', payload), name: data.name.trim() };
}

/** The school's short reply or reason: at most 500 characters, or null. */
function trialText(template: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '' || value.length > 500) throw new NotificationDataError(template, 'the reply must be a short text');
  return value.trim();
}

const TRIAL_INBOX = (schoolId: string) => `/dashboard/schools/${schoolId}/inquiries`;
const OWN_TRIAL_REQUESTS = '/dashboard/trial-lessons';

/**
 * "school.trial-requested" (M21): to the school's listing account and to the admins of the
 * organizations the school accepted a link from, when a signed-in adult asks for a trial lesson.
 * The sender's name and contact are only in the inbox, never in the notice or its e-mail.
 */
const schoolTrialRequested: NotificationTemplate<TrialNotice> = {
  name: 'school.trial-requested',
  parse: (payload) => trialNotice('school.trial-requested', payload),
  render: ({ schoolId, name }) => ({
    title: 'A trial lesson request',
    body: [{ text: `Someone asked for a trial lesson at “${name}”. Their name, the contact they chose and their message are in the school’s requests.` }],
    action: { label: 'Open the requests', href: TRIAL_INBOX(schoolId) },
  }),
  sample: { schoolId: '0190a5c0-0000-7000-8000-0000000000d1', inquiryId: '0190a5c0-0000-7000-8000-0000000000d2', name: 'Demo Wing Chun Hall' },
};

/** "school.trial-answered" (M21): to the sender, when the school marks the request answered, with its reply. */
const schoolTrialAnswered: NotificationTemplate<TrialNotice & { reply: string | null }> = {
  name: 'school.trial-answered',
  parse(payload) {
    const data = payloadObject('school.trial-answered', payload);
    return { ...trialNotice('school.trial-answered', payload), reply: trialText('school.trial-answered', data.reply) };
  },
  render: ({ name, reply }) => ({
    title: 'Your trial lesson request was answered',
    body: [{ text: reply ? `“${name}” answered your request for a trial lesson: “${reply}”` : `“${name}” marked your request for a trial lesson as answered. They reach you with the contact you chose.` }],
    action: { label: 'See your requests', href: OWN_TRIAL_REQUESTS },
  }),
  sample: { schoolId: '0190a5c0-0000-7000-8000-0000000000d1', inquiryId: '0190a5c0-0000-7000-8000-0000000000d2', name: 'Demo Wing Chun Hall', reply: 'Come on Tuesday at 18:30.' },
};

/** "school.trial-declined" (M21): to the sender, when the school declines the request, with its reason if it gave one. */
const schoolTrialDeclined: NotificationTemplate<TrialNotice & { reason: string | null }> = {
  name: 'school.trial-declined',
  parse(payload) {
    const data = payloadObject('school.trial-declined', payload);
    return { ...trialNotice('school.trial-declined', payload), reason: trialText('school.trial-declined', data.reason) };
  },
  render: ({ name, reason }) => ({
    title: 'Your trial lesson request was declined',
    body: [{ text: reason ? `“${name}” cannot offer you a trial lesson now. Their reason: “${reason}”` : `“${name}” cannot offer you a trial lesson now. The school finder shows other schools.` }],
    action: { label: 'See your requests', href: OWN_TRIAL_REQUESTS },
  }),
  sample: { schoolId: '0190a5c0-0000-7000-8000-0000000000d1', inquiryId: '0190a5c0-0000-7000-8000-0000000000d2', name: 'Demo Wing Chun Hall', reason: null },
};

// --- Billing (M22; docs/adr/0025-billing.md) ------------------------------------------------------
// Test mode only: every text says so. The date and what happens, never a countdown (CLAUDE.md §11).

const PAID_PLANS = ['premium_student', 'pro_sifu', 'federation'] as const satisfies readonly PlanCode[];
const NO_CHARGE = 'This is test mode: no real charge is ever made.';

interface BillingNotice {
  subscriptionId: string;
  planCode: (typeof PAID_PLANS)[number];
}

function billingNotice(template: string, payload: unknown): BillingNotice & { data: Record<string, unknown> } {
  const data = payloadObject(template, payload);
  if (typeof data.planCode !== 'string' || !(PAID_PLANS as readonly string[]).includes(data.planCode)) throw new NotificationDataError(template, 'planCode must be a paid plan');
  return { subscriptionId: uuidOf(template, 'subscriptionId', payload), planCode: data.planCode as BillingNotice['planCode'], data };
}

/** "billing.started" (M22): the subscription is active after a successful test checkout. */
const billingStarted: NotificationTemplate<BillingNotice & { renewsOn: string; cancelAtPeriodEnd: boolean }> = {
  name: 'billing.started',
  parse(payload) {
    const { data, ...base } = billingNotice('billing.started', payload);
    return { ...base, renewsOn: requiredDate('billing.started', 'renewsOn', data.renewsOn), cancelAtPeriodEnd: data.cancelAtPeriodEnd === true };
  },
  render: ({ planCode, renewsOn, cancelAtPeriodEnd }) => ({
    title: `Your plan is now ${PLANS[planCode].name}`,
    body: [
      {
        text: `${PLANS[planCode].name} is active now. ${cancelAtPeriodEnd ? `It runs until ${formatDay(renewsOn)} and does not renew.` : `It renews on ${formatDay(renewsOn)}; you can cancel at any time.`} ${NO_CHARGE}`,
      },
    ],
    action: SEE_YOUR_BILLING,
  }),
  sample: { subscriptionId: '0190a5c0-0000-7000-8000-0000000000e1', planCode: 'pro_sifu', renewsOn: '2027-01-15T10:00:00.000Z', cancelAtPeriodEnd: false },
};

/** "billing.cancel-scheduled" (M22): cancelled at the end of the period; access stays until then. */
const billingCancelScheduled: NotificationTemplate<BillingNotice & { endsOn: string }> = {
  name: 'billing.cancel-scheduled',
  parse(payload) {
    const { data, ...base } = billingNotice('billing.cancel-scheduled', payload);
    return { ...base, endsOn: requiredDate('billing.cancel-scheduled', 'endsOn', data.endsOn) };
  },
  render: ({ planCode, endsOn }) => ({
    title: `${PLANS[planCode].name} will not renew`,
    body: [
      {
        text: `You cancelled ${PLANS[planCode].name}. You keep it until ${formatDay(endsOn)}, and it does not renew after that. Nothing you added is deleted. You can resume it before then. ${NO_CHARGE}`,
      },
    ],
    action: SEE_YOUR_BILLING,
  }),
  sample: { subscriptionId: '0190a5c0-0000-7000-8000-0000000000e1', planCode: 'pro_sifu', endsOn: '2027-01-15T10:00:00.000Z' },
};

/** "billing.resumed" (M22): a cancellation at the period end was taken back. */
const billingResumed: NotificationTemplate<BillingNotice & { renewsOn: string }> = {
  name: 'billing.resumed',
  parse(payload) {
    const { data, ...base } = billingNotice('billing.resumed', payload);
    return { ...base, renewsOn: requiredDate('billing.resumed', 'renewsOn', data.renewsOn) };
  },
  render: ({ planCode, renewsOn }) => ({
    title: `${PLANS[planCode].name} renews again`,
    body: [{ text: `You resumed ${PLANS[planCode].name}. It renews on ${formatDay(renewsOn)}. ${NO_CHARGE}` }],
    action: SEE_YOUR_BILLING,
  }),
  sample: { subscriptionId: '0190a5c0-0000-7000-8000-0000000000e1', planCode: 'premium_student', renewsOn: '2027-01-15T10:00:00.000Z' },
};

/** "billing.payment-failed" (M22; DEFAULT M22, question 5): a renewal failed; access stays for the grace period. */
const billingPaymentFailed: NotificationTemplate<BillingNotice & { accessUntil: string }> = {
  name: 'billing.payment-failed',
  parse(payload) {
    const { data, ...base } = billingNotice('billing.payment-failed', payload);
    return { ...base, accessUntil: requiredDate('billing.payment-failed', 'accessUntil', data.accessUntil) };
  },
  render: ({ planCode, accessUntil }) => ({
    title: `The renewal of ${PLANS[planCode].name} did not go through`,
    body: [
      {
        text: `The test payment for the renewal of ${PLANS[planCode].name} failed. You keep the plan until ${formatDay(accessUntil)}. If the payment does not go through by then, the plan ends; nothing you added is deleted. ${NO_CHARGE}`,
      },
    ],
    action: SEE_YOUR_BILLING,
  }),
  sample: { subscriptionId: '0190a5c0-0000-7000-8000-0000000000e1', planCode: 'pro_sifu', accessUntil: '2027-01-22T10:00:00.000Z' },
};

/** "billing.payment-recovered" (M22): a failed renewal was paid within the grace period. */
const billingPaymentRecovered: NotificationTemplate<BillingNotice & { renewsOn: string }> = {
  name: 'billing.payment-recovered',
  parse(payload) {
    const { data, ...base } = billingNotice('billing.payment-recovered', payload);
    return { ...base, renewsOn: requiredDate('billing.payment-recovered', 'renewsOn', data.renewsOn) };
  },
  render: ({ planCode, renewsOn }) => ({
    title: `${PLANS[planCode].name} is paid`,
    body: [{ text: `The renewal of ${PLANS[planCode].name} went through. It renews next on ${formatDay(renewsOn)}. ${NO_CHARGE}` }],
    action: SEE_YOUR_BILLING,
  }),
  sample: { subscriptionId: '0190a5c0-0000-7000-8000-0000000000e1', planCode: 'pro_sifu', renewsOn: '2027-02-15T10:00:00.000Z' },
};

const BILLING_END_REASONS = ['unpaid', 'provider'] as const;

/** "billing.ended" (M22): a subscription ended for another reason than a cancellation at its period end. */
const billingEnded: NotificationTemplate<BillingNotice & { endedAt: string; reason: (typeof BILLING_END_REASONS)[number] }> = {
  name: 'billing.ended',
  parse(payload) {
    const { data, ...base } = billingNotice('billing.ended', payload);
    if (typeof data.reason !== 'string' || !(BILLING_END_REASONS as readonly string[]).includes(data.reason)) throw new NotificationDataError('billing.ended', 'reason must be unpaid or provider');
    return { ...base, endedAt: requiredDate('billing.ended', 'endedAt', data.endedAt), reason: data.reason as (typeof BILLING_END_REASONS)[number] };
  },
  render: ({ planCode, endedAt, reason }) => ({
    title: `${PLANS[planCode].name} ended`,
    body: [
      {
        text: `${reason === 'unpaid' ? `The renewal of ${PLANS[planCode].name} was not paid in time, so the plan ended on ${formatDay(endedAt)}.` : `${PLANS[planCode].name} ended on ${formatDay(endedAt)}.`} ${whatStays(planCode, PLANS[planCode].audience === 'sifu' ? 'free_sifu' : PLANS[planCode].audience === 'student' ? 'free_student' : planCode)} You can choose the plan again on the plans page. ${NO_CHARGE}`,
      },
    ],
    action: SEE_YOUR_BILLING,
  }),
  sample: { subscriptionId: '0190a5c0-0000-7000-8000-0000000000e1', planCode: 'pro_sifu', endedAt: '2027-01-22T10:00:00.000Z', reason: 'unpaid' },
};

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
  // M15.
  'organization.reviewed': organizationReviewed,
  'organization.admin_added': organizationAdminAdded,
  'organization.school_requested': organizationSchoolRequested,
  'organization.school_answered': organizationSchoolAnswered,
  // M24.
  'organization.member_left': organizationMemberLeft,
  'organization.membership_ended': organizationMembershipEnded,
  // M17.
  'event.published': eventPublished,
  'event.cancelled': eventCancelled,
  // M18.
  'security.password-changed': securityPasswordChanged,
  'security.two-factor-enabled': securityTwoFactorEnabled,
  'security.two-factor-disabled': securityTwoFactorDisabled,
  'security.backup-codes': securityBackupCodes,
  'security.email-changed': securityEmailChanged,
  'plan.expiring': planExpiring,
  'plan.expired': planExpired,
  'limit.reached': limitReached,
  'content.removed': contentRemoved,
  // M19.
  'passport.entry-added': passportEntryAdded,
  'passport.correction': passportCorrection,
  // M20.
  'school.activity-awaiting': schoolActivityAwaiting,
  'school.activity-hidden': schoolActivityHidden,
  // M21.
  'school.trial-requested': schoolTrialRequested,
  'school.trial-answered': schoolTrialAnswered,
  'school.trial-declined': schoolTrialDeclined,
  // M22.
  'billing.started': billingStarted,
  'billing.cancel-scheduled': billingCancelScheduled,
  'billing.resumed': billingResumed,
  'billing.payment-failed': billingPaymentFailed,
  'billing.payment-recovered': billingPaymentRecovered,
  'billing.ended': billingEnded,
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
