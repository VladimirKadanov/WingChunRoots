'use server';

// The password reset Server Actions (milestone M02): thin wrappers over Better Auth's
// POST /api/auth/request-password-reset and POST /api/auth/reset-password
// (src/server/rpc/parity.ts). A reset ends every session of the account.

import { redirect } from 'next/navigation';

import { authMessage } from '@/components/account/messages';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/account-limits';
import { emailValue, keepValues, looksLikeEmail, secretValue, textValue } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { authAction } from '@/server/auth/web';

export async function requestResetAction(_previous: FormState, form: FormData): Promise<FormState> {
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
  const result = await authAction('/request-password-reset', { body: { email } });
  if (!result.ok) return { status: 'error', message: authMessage(result.code), values };
  // The same answer for every address (no account enumeration).
  return { status: 'done', values: { email } };
}

export async function resetPasswordAction(_previous: FormState, form: FormData): Promise<FormState> {
  const token = textValue(form, 'token', 4096);
  const password = secretValue(form, 'password', MAX_PASSWORD_LENGTH + 1);
  if (!token) return { status: 'error', message: authMessage('INVALID_TOKEN') };
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return {
      status: 'error',
      message: 'Check the highlighted field.',
      fields: {
        password:
          password.length < MIN_PASSWORD_LENGTH
            ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
            : `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
      },
    };
  }
  const result = await authAction('/reset-password', { body: { newPassword: password, token } });
  if (!result.ok) {
    const field = result.code?.startsWith('PASSWORD_TOO_');
    return {
      status: 'error',
      message: field ? 'Check the highlighted field.' : authMessage(result.code),
      ...(field ? { fields: { password: authMessage(result.code) } } : {}),
    };
  }
  redirect('/sign-in?reset=1');
}
