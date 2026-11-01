'use server';

// The e-mail confirmation Server Actions (milestone M02): thin wrappers over Better Auth's
// GET /api/auth/verify-email and POST /api/auth/send-verification-email
// (src/server/rpc/parity.ts). The link in the e-mail opens /verify-email, which asks for a button
// press first, so a mail scanner that opens links cannot confirm an address. `next` (M10b review,
// requirements-2): the invitation a sign-up started from; the confirmation hands it to the sign-in,
// and a new link carries it again (callbackURL, src/server/auth/emails.ts).

import { redirect } from 'next/navigation';

import { authMessage } from '@/components/account/messages';
import { emailValue, keepValues, looksLikeEmail, textValue } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { isInvitationPath } from '@/lib/invitation-path';
import { safeNextPath } from '@/server/auth/guards';
import { confirmationEmail } from '@/server/auth/tokens';
import { authAction } from '@/server/auth/web';
import { formResult, rememberSignInEmail } from '@/server/forms/flash';

/** /verify-email with these parameters, and `next` when there is one. */
function verifyPage(next: string, params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ ...params, ...(next ? { next } : {}) }).toString();
  return search ? `/verify-email?${search}` : '/verify-email';
}

export async function confirmEmailAction(_previous: FormState, form: FormData): Promise<FormState> {
  const next = safeNextPath(textValue(form, 'next'), '');
  const state = await confirmEmail(form, next);
  // A refused link shows the page without it ("This link no longer works" and a new-link form);
  // any other error keeps the link, so the press can be tried again.
  const token = textValue(form, 'token', 4096);
  const page = state.values?.link === 'refused' || !token ? verifyPage(next) : verifyPage(next, { token });
  return formResult({ form: 'confirm-email', page }, state);
}

/**
 * The codes of a link that cannot be used: expired, malformed, issued before a new password, or of
 * an unconfirmed account that has since been deleted (USER_NOT_FOUND, said as an expired link).
 */
const REFUSED_LINK = new Set(['INVALID_TOKEN', 'TOKEN_EXPIRED', 'USER_NOT_FOUND', 'HTTP_401']);

/**
 * What a refused confirmation link says (fix round 3, screens-6). Not "already used": pressing a
 * link that has confirmed the address confirms it again.
 */
const LINK_REFUSED = 'This link is not valid or has expired. Ask for a new one below.';

async function confirmEmail(form: FormData, next: string): Promise<FormState> {
  const token = textValue(form, 'token', 4096);
  // `link: refused` swaps the page to "This link no longer works" with a form for a new link.
  if (!token) return { status: 'error', message: LINK_REFUSED, values: { link: 'refused' } };
  const result = await authAction('/verify-email', { method: 'GET', query: { token } });
  if (!result.ok) {
    const refused = REFUSED_LINK.has(result.code ?? '');
    return {
      status: 'error',
      message: refused && result.code !== 'TOKEN_EXPIRED' ? LINK_REFUSED : authMessage(result.code),
      ...(refused ? { values: { link: 'refused' } } : {}),
    };
  }
  // The endpoint has confirmed the address the token names: the sign-in form starts with it.
  const email = confirmationEmail(token);
  if (email) await rememberSignInEmail(email);
  redirect(`/sign-in?${new URLSearchParams({ verified: '1', ...(next ? { next } : {}) })}`);
}

export async function resendConfirmationAction(_previous: FormState, form: FormData): Promise<FormState> {
  const next = safeNextPath(textValue(form, 'next'), '');
  return formResult({ form: 'resend-confirmation', page: verifyPage(next) }, await resendConfirmation(form, next));
}

async function resendConfirmation(form: FormData, next: string): Promise<FormState> {
  const email = emailValue(form);
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
  const callback = isInvitationPath(next) ? { callbackURL: next } : {};
  const result = await authAction('/send-verification-email', { body: { email, ...callback }, anonymous: true });
  if (!result.ok) return { status: 'error', message: authMessage(result.code), values };
  // The same answer for every address (no account enumeration).
  return { status: 'done', values: { email } };
}
