// /verify-email (milestone M02, In scope 6 and 7). With `?token=` (the link in the e-mail) it asks
// for one button press and confirms the address; without a token, or once the link is refused, it
// sends a new link. `?outcome=` brings back the result of a submit without JavaScript
// (src/server/forms/flash.ts).

import type { Metadata } from 'next';

import { AuthFrame } from '@/components/account/auth-frame';
import { isRefusedLink } from '@/lib/form-state';
import { readFormResult } from '@/server/forms/flash';
import { AlreadyConfirmedFooter, ConfirmEmailForm, ResendConfirmationForm } from './forms';
import { RESEND, linkRefused } from './headings';

export const instant = false;

export const metadata: Metadata = {
  title: 'Confirm your e-mail',
  description: 'Confirm the e-mail address of your WingChunRoots account.',
  // The token is in the address: only the origin goes to other sites, and nothing is indexed.
  // Not `no-referrer`: with it a browser sends `Origin: null` with the form's POST, and Next.js
  // refuses a Server Action without a matching origin.
  referrer: 'strict-origin',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function VerifyEmailPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const token = typeof query.token === 'string' ? query.token.slice(0, 4096) : '';
  if (token) {
    const initial = await readFormResult('confirm-email', query.outcome);
    return (
      <AuthFrame>
        <ConfirmEmailForm token={token} initial={initial} />
      </AuthFrame>
    );
  }
  const [confirmed, resent] = await Promise.all([
    readFormResult('confirm-email', query.outcome),
    readFormResult('resend-confirmation', query.outcome),
  ]);
  const refused = isRefusedLink(confirmed) ? linkRefused(confirmed) : null;
  return (
    <AuthFrame>
      <ResendConfirmationForm
        heading={refused ?? RESEND}
        headingId={refused ? 'verify-link-refused' : undefined}
        initial={resent}
        footer={<AlreadyConfirmedFooter />}
      />
    </AuthFrame>
  );
}
