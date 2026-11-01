'use server';

// The sign-up form's Server Action (milestone M02): a thin wrapper over Better Auth's
// POST /api/auth/sign-up/email (src/server/rpc/parity.ts). The checks here only give the form
// its field messages; the endpoint and its hook refuse the same input for any client. The path of
// an invitation link in `next` goes to the endpoint as its callbackURL, which the confirmation
// e-mail's link keeps (src/server/auth/emails.ts; M10b review, requirements-2).

import { CONSENT_REQUIRED_MESSAGES, type ConsentName } from '@/components/account/consents';
import { authMessage } from '@/components/account/messages';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/account-limits';
import { emailValue, keepValues, looksLikeEmail, secretValue, textValue, ticked } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { isInvitationPath } from '@/lib/invitation-path';
import { safeNextPath } from '@/server/auth/guards';
import { authAction } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { REQUIRED_SIGN_UP_CONSENTS, SIGN_UP_CONSENTS } from '@/server/legal/documents';

export async function signUpAction(_previous: FormState, form: FormData): Promise<FormState> {
  const next = safeNextPath(textValue(form, 'next'), '');
  return formResult({ form: 'sign-up', page: next ? `/sign-up?${new URLSearchParams({ next })}` : '/sign-up' }, await signUp(form, next));
}

async function signUp(form: FormData, next: string): Promise<FormState> {
  const email = emailValue(form);
  const password = secretValue(form, 'password', MAX_PASSWORD_LENGTH + 1);
  const consents = Object.fromEntries(SIGN_UP_CONSENTS.map((kind) => [kind, ticked(form, kind)]));
  const values = keepValues(form, ['email'], SIGN_UP_CONSENTS);

  const fields: Record<string, string> = {};
  if (!email) fields.email = 'Enter your e-mail address.';
  else if (!looksLikeEmail(email)) fields.email = authMessage('INVALID_EMAIL');
  if (!password) fields.password = 'Enter a password.';
  else if (password.length < MIN_PASSWORD_LENGTH) fields.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  else if (password.length > MAX_PASSWORD_LENGTH) fields.password = `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  for (const kind of REQUIRED_SIGN_UP_CONSENTS) {
    if (!consents[kind]) fields[kind] = CONSENT_REQUIRED_MESSAGES[kind as ConsentName];
  }
  if (Object.keys(fields).length > 0) return { status: 'error', message: 'Check the highlighted fields.', fields, values };

  // `name` is required by Better Auth; the person's names are asked at onboarding.
  const callback = isInvitationPath(next) ? { callbackURL: next } : {};
  const result = await authAction('/sign-up/email', { body: { name: '', email, password, consents, ...callback } });
  if (!result.ok) {
    const field =
      result.code === 'INVALID_EMAIL' ? 'email' : result.code?.startsWith('PASSWORD_TOO_') ? 'password' : null;
    return {
      status: 'error',
      message: field ? 'Check the highlighted fields.' : authMessage(result.code),
      ...(field ? { fields: { [field]: authMessage(result.code) } } : {}),
      values,
    };
  }
  // The same answer whether or not the address already has an account (no account enumeration).
  return { status: 'done', values: { email } };
}
