// /sign-in (milestone M02, In scope 7). `?next=` is the local page to open afterwards;
// `?verified=1` and `?reset=1` say what just happened. Reads the query string, so the page renders
// per request (instant = false: allowed to block, docs/adr/0004-auth.md).

import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthFrame, FormFooter } from '@/components/account/auth-frame';
import { safeNextPath } from '@/server/auth/guards';
import { SignInForm } from './sign-in-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your WingChunRoots account.',
};

const NOTICES = {
  verified: 'Your e-mail address is confirmed. Sign in to continue.',
  reset: 'Your password is changed and every other session has ended. Sign in with the new password.',
  'signed-out': 'You are signed out.',
} as const;

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const next = safeNextPath(query.next, '');
  const notice = (Object.keys(NOTICES) as (keyof typeof NOTICES)[]).find((key) => query[key] === '1');
  return (
    <AuthFrame eyebrow="Account" title="Sign in" lede={next ? 'Sign in to open the page you asked for.' : undefined}>
      {notice ? (
        <p role="status" className="mb-6 flex gap-2 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm">
          <span aria-hidden="true" className="font-semibold">
            ✓
          </span>
          <span>{NOTICES[notice]}</span>
        </p>
      ) : null}
      <SignInForm next={next} />
      <FormFooter>
        <p>
          New here?{' '}
          <Link href="/sign-up" className="link inline-flex min-h-11 items-center">
            Create an account
          </Link>
        </p>
        <p>
          Waiting for the confirmation e-mail?{' '}
          <Link href="/verify-email" className="link inline-flex min-h-11 items-center">
            Send it again
          </Link>
        </p>
      </FormFooter>
    </AuthFrame>
  );
}
