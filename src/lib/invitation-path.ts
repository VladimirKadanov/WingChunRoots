// The paths that ride in the confirmation e-mail's link (milestone M10b, In scope 2; M21 trial
// lessons). An invitation link, /invite/<token> (32 random bytes in base64url, 43 characters), and
// the trial lesson request page of a school, /schools/<slug>/trial. Sign-up keeps such a path as
// its `next` through the confirmation e-mail and the sign-in that follows (src/app/sign-up,
// src/server/auth/emails.ts), so a teacher invited without an account comes back to the claim
// instead of setting up a profile of their own, and a visitor who asked a school for a trial lesson
// comes back to that request after onboarding. The claim page of a public profile,
// /people/<slug>/claim (ADR 0040), rides too (all-roles replay 2026-11-25): without it a visitor who
// pressed "Is this you?" lost the claim at sign-up, set up a profile of their own in onboarding, and
// then could claim nothing. An organization's claim link of an imported member, /claim/<token>
// (ADR 0074), rides for the same reason.

const INVITATION_PATH = /^\/invite\/[A-Za-z0-9_-]{43}$/;
/** The slug rule of /schools/[slug]/trial (its page refuses any other slug). */
const TRIAL_PATH = /^\/schools\/[a-z0-9-]{1,120}\/trial$/;
/** The slug rule of /people/[slug]/claim (the claim page refuses any other slug). */
const CLAIM_PATH = /^\/people\/[a-z0-9]+(?:-[a-z0-9]+)*\/claim$/;

/** Whether `path` is the local path of an invitation link. */
export function isInvitationPath(path: unknown): path is string {
  return typeof path === 'string' && INVITATION_PATH.test(path);
}

const CLAIM_LINK_PATH = /^\/claim\/[A-Za-z0-9_-]{43}$/;

/** Whether `path` is the local path of an organization's claim link (ADR 0074). */
export function isClaimLinkPath(path: unknown): path is string {
  return typeof path === 'string' && CLAIM_LINK_PATH.test(path);
}

/** Whether `path` is the local path of a school's trial lesson request page. */
export function isTrialPath(path: unknown): path is string {
  return typeof path === 'string' && TRIAL_PATH.test(path);
}

/** Whether `path` is the local path of a public profile's claim page. */
export function isClaimPath(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 140 && CLAIM_PATH.test(path);
}

/**
 * A Sifu's invite link (/join/<slug>, role replay 2026-11-25, P1-3) leads to the request form with
 * that teacher chosen: a new student comes back to it after the e-mail and onboarding.
 */
const TEACHER_REQUEST_PATH = /^\/dashboard\/teachers\/new\?teacher=[a-z0-9]+(?:-[a-z0-9]+)*(?:&from=invite)?$/;

/** Whether `path` is the request form with a teacher chosen (the target of a Sifu's invite link). */
export function isTeacherRequestPath(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 160 && TEACHER_REQUEST_PATH.test(path);
}

/**
 * The request form with `slug` chosen as the teacher; with `invite`, from that teacher's own invite
 * link (/join/<slug>), so the request is marked for the teacher (ADR 0073; a hint, never an approval).
 */
export const teacherRequestPath = (slug: string, opts: { invite?: boolean } = {}) => `/dashboard/teachers/new?teacher=${slug}${opts.invite ? '&from=invite' : ''}`;

/** Whether `path` rides in the confirmation e-mail's link (nothing else does). */
export function ridesInConfirmationLink(path: unknown): path is string {
  return isInvitationPath(path) || isClaimLinkPath(path) || isTrialPath(path) || isClaimPath(path) || isTeacherRequestPath(path);
}
