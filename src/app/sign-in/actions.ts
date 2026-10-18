'use server';

// The sign-in Server Actions (milestone M02): thin wrappers over Better Auth's
// POST /api/auth/sign-in/email, /two-factor/verify-totp and /two-factor/verify-backup-code
// (src/server/rpc/parity.ts). The session cookie Better Auth sets is passed on to the browser.

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { authMessage } from '@/components/account/messages';
import { MAX_PASSWORD_LENGTH } from '@/lib/account-limits';
import { emailValue, keepValues, looksLikeEmail, secretValue, textValue } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { safeNextPath } from '@/server/auth/guards';
import { authAction, principalFromSetCookies } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';

interface SignedIn {
  twoFactorRedirect?: boolean;
  user?: { id: string };
}

/**
 * Where the new session goes next (account.landing): read with the session Better Auth has just
 * created, whose cookie the browser sends only with its next request.
 */
async function landingAfter(setCookies: readonly string[], next: string): Promise<string> {
  const principal = await principalFromSetCookies(setCookies);
  const { path } = await serverClient(await headers(), principal).account.landing({ next: next || undefined });
  return path;
}

export async function signInAction(_previous: FormState, form: FormData): Promise<FormState> {
  const email = emailValue(form);
  const password = secretValue(form, 'password', MAX_PASSWORD_LENGTH + 1);
  const next = safeNextPath(textValue(form, 'next'), '');
  const values = keepValues(form, ['email', 'next']);

  const fields: Record<string, string> = {};
  if (!email) fields.email = 'Enter your e-mail address.';
  else if (!looksLikeEmail(email)) fields.email = authMessage('INVALID_EMAIL');
  if (!password) fields.password = 'Enter your password.';
  if (Object.keys(fields).length > 0) return { status: 'error', message: 'Check the highlighted fields.', fields, values };

  const result = await authAction<SignedIn>('/sign-in/email', { body: { email, password, rememberMe: true } });
  if (!result.ok || !result.data) return { status: 'error', message: authMessage(result.code), values };

  if (result.data.twoFactorRedirect) {
    redirect(`/sign-in/two-factor${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  }
  redirect(await landingAfter(result.setCookies, next));
}

export async function verifySecondFactorAction(_previous: FormState, form: FormData): Promise<FormState> {
  const method = textValue(form, 'method') === 'backup' ? 'backup' : 'totp';
  // TOTP codes are often pasted as "123 456"; backup codes keep their dash ("abcde-12345").
  const typed = secretValue(form, 'code', 64).trim();
  const code = method === 'totp' ? typed.replace(/\s/g, '') : typed;
  const next = safeNextPath(textValue(form, 'next'), '');
  const values = keepValues(form, ['next', 'method']);
  if (!code) {
    return {
      status: 'error',
      message: 'Check the highlighted field.',
      fields: { code: method === 'totp' ? 'Enter the 6-digit code from your authenticator app.' : 'Enter one of your backup codes.' },
      values,
    };
  }
  // A staff account never gets a trusted device (src/server/auth/hooks.ts); the form does not offer it.
  const path = method === 'totp' ? '/two-factor/verify-totp' : '/two-factor/verify-backup-code';
  const result = await authAction<{ user?: { id: string } }>(path, { body: { code } });
  if (!result.ok || !result.data?.user) {
    const field = result.code === 'INVALID_CODE' || result.code === 'INVALID_BACKUP_CODE';
    return {
      status: 'error',
      message: field ? 'Check the highlighted field.' : authMessage(result.code),
      ...(field ? { fields: { code: authMessage(result.code) } } : {}),
      values,
    };
  }
  redirect(await landingAfter(result.setCookies, next));
}
