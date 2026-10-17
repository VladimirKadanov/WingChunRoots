// /verify-email (milestone M02, In scope 6 and 7). With `?token=` (the link in the e-mail) it asks
// for one button press and confirms the address; without a token, or when the link has expired, it
// sends a new link.

import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthFrame, FormFooter } from '@/components/account/auth-frame';
import { ConfirmEmailForm, ResendConfirmationForm } from './forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Confirm your e-mail',
  description: 'Confirm the e-mail address of your WingChunRoots account.',
  // The token is in the address: no referrer to other sites, no indexing.
  referrer: 'no-referrer',
  robots: { index: false },
};

const NOTES = [
  {
    title: 'Why we ask',
    text: 'Confirming shows the address is yours before anyone can sign in with it, and that our e-mails reach you.',
  },
  {
    title: 'One press',
    text: 'The link opens this page and waits for your press, so a mail scanner that follows links cannot confirm the address for you.',
  },
  {
    title: '24 hours',
    text: 'The link works for a day. If it has run out, ask for a new one; nothing else about your account changes.',
  },
] as const;

/** "e-mail" never breaks at its hyphen in a heading. */
const TITLE = (
  <>
    Confirm your <span className="whitespace-nowrap">e-mail</span> address
  </>
);

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function VerifyEmailPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const token = typeof query.token === 'string' ? query.token.slice(0, 4096) : '';
  if (token) {
    return (
      <AuthFrame
        eyebrow="Account"
        title={TITLE}
        lede="Press the button to confirm that this address is yours. Then sign in with your password."
        notes={NOTES}
        notesLabel="Confirming your address"
      >
        <ConfirmEmailForm token={token} />
        <div className="mt-10 border-t border-border-subtle pt-8">
          <ResendConfirmationForm title="Link expired? Send a new one" secondary />
        </div>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame
      eyebrow="Account"
      title={TITLE}
      lede="We sent a confirmation link when you created your account. It works for 24 hours. If it did not arrive or has expired, ask for a new one."
      notes={NOTES}
      notesLabel="Confirming your address"
    >
      <ResendConfirmationForm />
      <FormFooter>
        <p>
          Already confirmed?{' '}
          <Link href="/sign-in" className="link inline-flex min-h-11 items-center">
            Sign in
          </Link>
        </p>
      </FormFooter>
    </AuthFrame>
  );
}
