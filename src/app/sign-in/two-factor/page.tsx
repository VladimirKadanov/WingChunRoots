// /sign-in/two-factor (milestone M02): the second step of signing in to an account with
// two-factor authentication. Better Auth keeps the pending sign-in in its signed `two_factor`
// cookie; this page asks for the TOTP code or, with `?method=backup`, a backup code. `?outcome=`
// brings back the result of a submit without JavaScript (src/server/forms/flash.ts). Only a
// browser with that cookie is told that its password was right (fix round 3, screens-5).

import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthFrame, FormFooter } from '@/components/account/auth-frame';
import { safeNextPath } from '@/server/auth/guards';
import { hasPendingSecondFactor } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { TwoFactorForm } from './two-factor-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Two-factor check',
  description: 'Enter the code from your authenticator app to finish signing in.',
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function TwoFactorPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const next = safeNextPath(query.next, '');
  const method = query.method === 'backup' ? 'backup' : 'totp';
  const initial = await readFormResult('second-factor', query.outcome);
  const waiting = await hasPendingSecondFactor();
  const withNext = (params: Record<string, string>) => {
    const search = new URLSearchParams({ ...params, ...(next ? { next } : {}) }).toString();
    return `/sign-in/two-factor${search ? `?${search}` : ''}`;
  };
  return (
    <AuthFrame
      eyebrow="Sign in · step 2 of 2"
      title={method === 'totp' ? 'Enter your code' : 'Use a backup code'}
      lede={
        waiting
          ? 'Your password was right. This account also asks for a second factor.'
          : 'Signing in to an account with two-factor authentication asks for a code after the password.'
      }
    >
      <TwoFactorForm key={method} method={method} next={next} initial={initial} />
      <FormFooter>
        <p>
          {method === 'totp' ? (
            <Link href={withNext({ method: 'backup' })} className="link inline-flex min-h-11 items-center">
              No phone at hand? Use a backup code
            </Link>
          ) : (
            <Link href={withNext({})} className="link inline-flex min-h-11 items-center">
              Use the code from your authenticator app
            </Link>
          )}
        </p>
        <p>
          <Link href="/sign-in" className="link inline-flex min-h-11 items-center">
            Back to sign-in
          </Link>
        </p>
      </FormFooter>
    </AuthFrame>
  );
}
