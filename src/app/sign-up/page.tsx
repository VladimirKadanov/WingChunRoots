// /sign-up (milestone M02, In scope 4 and 7): e-mail, password and four confirmations, none of
// them ticked in advance. The form posts to a Server Action and works before JavaScript loads; a
// submit without JavaScript comes back as `?outcome=` (src/server/forms/flash.ts), so the page reads
// the query string and renders per request (instant = false, docs/adr/0004-auth.md).

import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthFrame, FormFooter } from '@/components/account/auth-frame';
import { readFormResult } from '@/server/forms/flash';
import { LEGAL_DOCUMENTS, REQUIRED_SIGN_UP_CONSENTS } from '@/server/legal/documents';
import { SignUpForm } from './sign-up-form';

export const instant = false;

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

type Search = Promise<Record<string, string | string[] | undefined>>;

const doc = ({ title, path, date }: { title: string; path: string; date: string }) => ({ title, path, date });

export default async function SignUpPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const initial = await readFormResult('sign-up', query.outcome);
  return (
    <AuthFrame notes={NOTES} notesLabel="How joining works">
      <SignUpForm
        required={REQUIRED_SIGN_UP_CONSENTS}
        terms={doc(LEGAL_DOCUMENTS.terms)}
        privacy={doc(LEGAL_DOCUMENTS.privacy)}
        initial={initial}
        footer={
          <FormFooter>
            <p>
              Already have an account?{' '}
              <Link href="/sign-in" className="link inline-flex min-h-11 items-center">
                Sign in
              </Link>
            </p>
          </FormFooter>
        }
      />
    </AuthFrame>
  );
}
