// The paths that ride in the confirmation e-mail's link (milestone M10b, In scope 2; M21 trial
// lessons). An invitation link, /invite/<token> (32 random bytes in base64url, 43 characters), and
// the trial lesson request page of a school, /schools/<slug>/trial. Sign-up keeps such a path as
// its `next` through the confirmation e-mail and the sign-in that follows (src/app/sign-up,
// src/server/auth/emails.ts), so a teacher invited without an account comes back to the claim
// instead of setting up a profile of their own, and a visitor who asked a school for a trial lesson
// comes back to that request after onboarding.

const INVITATION_PATH = /^\/invite\/[A-Za-z0-9_-]{43}$/;
/** The slug rule of /schools/[slug]/trial (its page refuses any other slug). */
const TRIAL_PATH = /^\/schools\/[a-z0-9-]{1,120}\/trial$/;

/** Whether `path` is the local path of an invitation link. */
export function isInvitationPath(path: unknown): path is string {
  return typeof path === 'string' && INVITATION_PATH.test(path);
}

/** Whether `path` is the local path of a school's trial lesson request page. */
export function isTrialPath(path: unknown): path is string {
  return typeof path === 'string' && TRIAL_PATH.test(path);
}

/** Whether `path` rides in the confirmation e-mail's link (nothing else does). */
export function ridesInConfirmationLink(path: unknown): path is string {
  return isInvitationPath(path) || isTrialPath(path);
}
