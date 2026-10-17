'use server';

// The security page's Server Actions (milestone M02): thin wrappers over Better Auth's
// POST /api/auth/two-factor/enable, /two-factor/verify-totp and /two-factor/verify-backup-code
// (src/server/rpc/parity.ts).
//
// - Turning two-factor authentication on takes the password and returns the TOTP secret (as a QR
//   code and as text) and the backup codes. The first valid code finishes the setup: Better Auth
//   turns it on, every session of the account ends (src/server/db/migrations: the session
//   trigger) and this browser gets a new session, already verified.
// - A session of an account with two-factor authentication that has not passed the second factor
//   (only possible for sessions created outside the sign-in form) verifies it here; staff pages
//   require it (requireStaff2FA).

import { redirect } from 'next/navigation';

import { authMessage } from '@/components/account/messages';
import { MAX_PASSWORD_LENGTH } from '@/lib/account-limits';
import { keepValues, secretValue, textValue } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { safeNextPath } from '@/server/auth/guards';
import { totpSetupView } from '@/server/auth/totp';
import { authAction } from '@/server/auth/web';

export async function enableTwoFactorAction(_previous: FormState, form: FormData): Promise<FormState> {
  const password = secretValue(form, 'password', MAX_PASSWORD_LENGTH + 1);
  if (!password) {
    return { status: 'error', message: 'Check the highlighted field.', fields: { password: 'Enter your password to continue.' } };
  }
  const result = await authAction<{ totpURI?: string; backupCodes?: string[] }>('/two-factor/enable', { body: { password } });
  if (!result.ok || !result.data?.totpURI) {
    if (result.code === 'INVALID_PASSWORD') {
      return { status: 'error', message: 'Check the highlighted field.', fields: { password: authMessage('INVALID_PASSWORD') } };
    }
    return { status: 'error', message: authMessage(result.code) };
  }
  return { status: 'done', data: { setup: totpSetupView(result.data.totpURI, result.data.backupCodes ?? []) } };
}

async function verifyCode(form: FormData): Promise<FormState | { ok: true }> {
  const method = textValue(form, 'method') === 'backup' ? 'backup' : 'totp';
  const typed = secretValue(form, 'code', 64).trim();
  const code = method === 'totp' ? typed.replace(/\s/g, '') : typed;
  const values = keepValues(form, ['next', 'method']);
  if (!code) {
    return {
      status: 'error',
      message: 'Check the highlighted field.',
      fields: { code: method === 'totp' ? 'Enter the 6-digit code from your authenticator app.' : 'Enter one of your backup codes.' },
      values,
    };
  }
  const path = method === 'totp' ? '/two-factor/verify-totp' : '/two-factor/verify-backup-code';
  const result = await authAction(path, { body: { code } });
  if (result.ok) return { ok: true };
  const field = result.code === 'INVALID_CODE' || result.code === 'INVALID_BACKUP_CODE';
  return {
    status: 'error',
    message: field ? 'Check the highlighted field.' : authMessage(result.code),
    ...(field ? { fields: { code: authMessage(result.code) } } : {}),
    values,
  };
}

export async function confirmTwoFactorAction(_previous: FormState, form: FormData): Promise<FormState> {
  const outcome = await verifyCode(form);
  if (!('ok' in outcome)) return outcome;
  redirect('/account/security?enabled=1');
}

export async function verifySessionAction(_previous: FormState, form: FormData): Promise<FormState> {
  const outcome = await verifyCode(form);
  if (!('ok' in outcome)) return outcome;
  redirect(safeNextPath(textValue(form, 'next'), '/account/security?verified=1'));
}
