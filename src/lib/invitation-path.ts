// The path of an invitation link, /invite/<token> (milestone M10b, In scope 2): 32 random bytes in
// base64url, 43 characters. Sign-up keeps such a path as its `next` through the confirmation e-mail
// and the sign-in that follows (src/app/sign-up, src/server/auth/emails.ts), so a teacher invited
// without an account comes back to the claim instead of setting up a profile of their own.

const INVITATION_PATH = /^\/invite\/[A-Za-z0-9_-]{43}$/;

/** Whether `path` is the local path of an invitation link (nothing else rides in the e-mail link). */
export function isInvitationPath(path: unknown): path is string {
  return typeof path === 'string' && INVITATION_PATH.test(path);
}
