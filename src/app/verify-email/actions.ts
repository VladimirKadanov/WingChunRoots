'use server';

// The e-mail confirmation Server Actions (milestone M02): thin wrappers over Better Auth's
// GET /api/auth/verify-email and POST /api/auth/send-verification-email
// (src/server/rpc/parity.ts). The link in the e-mail opens /verify-email, which asks for a button
// press first, so a mail scanner that opens links cannot confirm an address.

import { redirect } from 'next/navigation';

import { authMessage } from '@/components/account/messages';
import { keepValues, looksLikeEmail, textValue } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { authAction } from '@/server/auth/web';

export async function confirmEmailAction(_previous: FormState, form: FormData): Promise<FormState> {
  const token = textValue(form, 'token', 4096);
  if (!token) return { status: 'error', message: authMessage('INVALID_TOKEN') };
  const result = await authAction('/verify-email', { method: 'GET', query: { token } });
  if (!result.ok) return { status: 'error', message: authMessage(result.code === 'HTTP_401' ? 'INVALID_TOKEN' : result.code) };
  redirect('/sign-in?verified=1');
}

export async function resendConfirmationAction(_previous: FormState, form: FormData): Promise<FormState> {
  const email = textValue(form, 'email', 254).toLowerCase();
  const values = keepValues(form, ['email']);
  if (!email || !looksLikeEmail(email)) {
    return {
      status: 'error',
      message: 'Check the highlighted field.',
      fields: { email: email ? authMessage('INVALID_EMAIL') : 'Enter your e-mail address.' },
      values,
    };
  }
  // Without the session: a signed-in visitor asking for any address gets the same neutral answer
  // (with a session, Better Auth answers EMAIL_MISMATCH or EMAIL_ALREADY_VERIFIED instead).
  const result = await authAction('/send-verification-email', { body: { email }, anonymous: true });
  if (!result.ok) return { status: 'error', message: authMessage(result.code), values };
  // The same answer for every address (no account enumeration).
  return { status: 'done', values: { email } };
}
