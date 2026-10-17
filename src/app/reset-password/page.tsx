// /reset-password (milestone M02, In scope 6 and 7). Without a token it sends a reset link; with
// `?token=` (the link in the e-mail) it sets the new password. A reset ends every session.

import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthFrame, FormFooter } from '@/components/account/auth-frame';
import { NewPasswordForm, RequestResetForm } from './forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Reset your password',
  description: 'Choose a new password for your WingChunRoots account.',
  // The token is in the address: no referrer to other sites, no indexing.
  referrer: 'no-referrer',
  robots: { index: false },
};

const NOTES = [
  {
    title: 'One link, one hour',
    text: 'The link in the e-mail works once and runs out after an hour. If it has, ask for a new one here.',
  },
  {
    title: 'Every session ends',
    text: 'Saving the new password signs your account out on every device, so the old password opens nothing.',
  },
  {
    title: 'Your second factor stays',
    text: 'If you use two-factor authentication, it stays on: you still enter the code from your app when you sign in.',
  },
] as const;

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const token = typeof query.token === 'string' ? query.token.slice(0, 4096) : '';
  if (token) {
    return (
      <AuthFrame
        eyebrow="Account"
        title="Choose a new password"
        lede="The link in your e-mail works once, for one hour."
        notes={NOTES}
        notesLabel="How a reset works"
      >
        <NewPasswordForm token={token} />
      </AuthFrame>
    );
  }
  return (
    <AuthFrame
      eyebrow="Account"
      title="Reset your password"
      lede="Enter the address of your account. We send a link to choose a new password."
      notes={NOTES}
      notesLabel="How a reset works"
    >
      <RequestResetForm />
      <FormFooter>
        <p>
          <Link href="/sign-in" className="link inline-flex min-h-11 items-center">
            Back to sign in
          </Link>
        </p>
      </FormFooter>
    </AuthFrame>
  );
}
