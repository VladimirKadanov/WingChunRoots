// /reset-password (milestone M02, In scope 6 and 7). Without a token it sends a reset link; with
// `?token=` (the link in the e-mail) it sets the new password, and with `&finish=1` it finishes a
// sign-up (src/server/auth/accounts.ts). A reset ends every session. `?outcome=` brings back the
// result of a submit without JavaScript (src/server/forms/flash.ts).

import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthFrame, FormFooter } from '@/components/account/auth-frame';
import { isRefusedLink } from '@/lib/form-state';
import { readFormResult } from '@/server/forms/flash';
import { NewPasswordForm, RequestResetForm } from './forms';
import { FINISH, NEW_PASSWORD, REQUEST, linkRefused } from './headings';

export const instant = false;

type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const finish = (await searchParams).finish === '1';
  return {
    title: finish ? 'Finish signing up' : 'Reset your password',
    description: finish ? 'Choose the password for your new WingChunRoots account.' : 'Choose a new password for your WingChunRoots account.',
    // The token is in the address: only the origin goes to other sites, and nothing is indexed.
    // Not `no-referrer`: with it a browser sends `Origin: null` with the form's POST, and Next.js
    // refuses a Server Action without a matching origin.
    referrer: 'strict-origin',
    robots: { index: false },
  };
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const token = typeof query.token === 'string' ? query.token.slice(0, 4096) : '';
  const finish = query.finish === '1';
  if (token) {
    const initial = await readFormResult('new-password', query.outcome);
    return (
      <AuthFrame>
        <NewPasswordForm token={token} finish={finish} heading={finish ? FINISH : NEW_PASSWORD} initial={initial} />
      </AuthFrame>
    );
  }
  const [refusedLink, requested] = await Promise.all([
    readFormResult('new-password', query.outcome),
    readFormResult('request-reset', query.outcome),
  ]);
  const refused = isRefusedLink(refusedLink) ? linkRefused(refusedLink) : null;
  return (
    <AuthFrame>
      <RequestResetForm
        heading={refused ?? REQUEST}
        headingId={refused ? 'reset-link-refused' : undefined}
        initial={requested}
        footer={
          <FormFooter>
            <p>
              <Link href="/sign-in" className="link inline-flex min-h-11 items-center">
                Back to sign-in
              </Link>
            </p>
          </FormFooter>
        }
      />
    </AuthFrame>
  );
}
