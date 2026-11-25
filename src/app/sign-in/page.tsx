// /sign-in (milestone M02, In scope 7). `?next=` is the local page to open afterwards;
// `?verified=1`, `?reset=1` and `?signed-out=1` say what just happened; `?outcome=` brings back the
// result of a submit without JavaScript (src/server/forms/flash.ts). Reads the query string and the
// cookies, so the page renders per request (instant = false: allowed to block, docs/adr/0004-auth.md).

import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthFrame, FormFooter, Notice } from '@/components/account/auth-frame';
import { ForgetRecentSearches } from '@/components/account/forget-recent-searches';
import { isClaimPath, isInvitationPath, isTeacherRequestPath, isTrialPath } from '@/lib/invitation-path';
import { safeNextPath } from '@/server/auth/guards';
import { readFormResult, readSignInEmail } from '@/server/forms/flash';
import { SignInForm } from './sign-in-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your WingChunRoots account.',
};

const NOTICES = {
  verified: 'Address confirmed. Sign in to continue.',
  reset: 'Password changed, and every other session has ended. Sign in with the new password.',
  'signed-out': 'You are signed out.',
} as const;

/**
 * Why the visitor is asked to sign in, in words, when they came from a step that needs an account
 * (role replay 2026-11-25, P1-6: a beginner asking a school for a trial lesson met a bare form).
 */
function ledeFor(next: string): string | undefined {
  if (!next) return undefined;
  if (isTrialPath(next)) return 'Sign in, or create an account, to ask this school for a trial lesson. It takes a few minutes, and your profile stays private.';
  if (isTeacherRequestPath(next)) return 'Sign in, or create an account, to ask your teacher to confirm that they teach you.';
  if (isClaimPath(next)) return 'Sign in, or create an account, to ask to claim this profile.';
  if (isInvitationPath(next)) return 'Sign in, or create an account, to answer the invitation.';
  return 'Sign in to open the page you asked for.';
}

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const next = safeNextPath(query.next, '');
  const notice = (Object.keys(NOTICES) as (keyof typeof NOTICES)[]).find((key) => query[key] === '1');
  const [initial, email] = await Promise.all([readFormResult('sign-in', query.outcome), readSignInEmail()]);
  return (
    <AuthFrame
      eyebrow="Welcome back"
      title="Sign in"
      lede={ledeFor(next)}
    >
      {notice ? <Notice>{NOTICES[notice]}</Notice> : null}
      {notice === 'signed-out' ? <ForgetRecentSearches /> : null}
      <SignInForm next={next} email={notice === 'verified' ? email : null} initial={initial} />
      <FormFooter>
        <p>
          New here?{' '}
          <Link href={next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up'} className="link inline-flex min-h-11 items-center">
            Create an account
          </Link>
        </p>
        <p>
          Waiting for the confirmation e-mail?{' '}
          <Link href={next ? `/verify-email?next=${encodeURIComponent(next)}` : '/verify-email'} className="link inline-flex min-h-11 items-center">
            Send it again
          </Link>
        </p>
      </FormFooter>
    </AuthFrame>
  );
}
