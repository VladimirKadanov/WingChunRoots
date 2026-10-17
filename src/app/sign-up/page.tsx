// /sign-up (milestone M02, In scope 4 and 7): e-mail, password and four confirmations, none of
// them ticked in advance. The page itself is static; the form posts to a Server Action and works
// before JavaScript loads.

import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthFrame, FormFooter } from '@/components/account/auth-frame';
import { REQUIRED_SIGN_UP_CONSENTS } from '@/server/legal/documents';
import { SignUpForm } from './sign-up-form';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Join the WingChunRoots pilot: record who taught you and whom you teach.',
};

const NOTES = [
  {
    title: 'Adults only',
    text: 'The pilot is open to people aged 18 or older. A tick confirms it; we never ask for a birth date.',
  },
  {
    title: 'Confirm your address',
    text: 'We e-mail you a link that works for 24 hours. You can sign in once the address is confirmed.',
  },
  {
    title: 'Then your name',
    text: 'After signing in you add your name in Latin letters and, if you like, in its original script. Your profile stays private until you choose otherwise.',
  },
] as const;

export default function SignUpPage() {
  return (
    <AuthFrame
      eyebrow="Join the pilot"
      title="Create your account"
      lede="An account lets you record who taught you and whom you teach. Every link is confirmed by the other person or by evidence before it is shown as fact."
      notes={NOTES}
      notesLabel="How joining works"
    >
      <SignUpForm required={REQUIRED_SIGN_UP_CONSENTS} />
      <FormFooter>
        <p>
          Already have an account?{' '}
          <Link href="/sign-in" className="link inline-flex min-h-11 items-center">
            Sign in
          </Link>
        </p>
      </FormFooter>
    </AuthFrame>
  );
}
