'use server';

// The security page's Server Actions (milestone M02): thin wrappers over Better Auth's
// POST /api/auth/two-factor/enable, /two-factor/verify-totp, /two-factor/verify-backup-code,
// /two-factor/generate-backup-codes and /two-factor/disable (src/server/rpc/parity.ts).
//
// - Setting up takes the password. Better Auth stores the new secret (pending until the first code)
//   and returns the setup's URI and the backup codes once; both are kept sealed for this browser
//   (src/server/forms/two-factor.ts), so the page renders the pending setup without JavaScript and
//   after a reload, and shows the codes after the first code.
// - The first valid code turns it on: every session of the account ends (the session trigger) and
//   this browser gets a new one, already verified; the page then shows the backup codes to save.
// - "Get new backup codes" takes the password and replaces them; members can turn two-factor
//   authentication off with the password (staff cannot: src/server/auth/hooks.ts).
// - A session of an account with two-factor authentication that has not passed the second factor
//   (only possible for sessions created outside the sign-in form) verifies it here; staff pages
//   require it (requireStaff2FA).

import { redirect } from 'next/navigation';

import { authMessage } from '@/components/account/messages';
import { MAX_PASSWORD_LENGTH } from '@/lib/account-limits';
import { keepValues, secretValue, textValue } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { safeNextPath } from '@/server/auth/guards';
import { authAction, getRequestPrincipal } from '@/server/auth/web';
import { keepBackupCodes, keepPendingSetup } from '@/server/forms/two-factor';
import { formResult } from '@/server/forms/flash';

const PAGE = '/account/security';

/** The password field's own message, or null when it is filled in. */
function passwordMissing(password: string): FormState | null {
  if (password) return null;
  return { status: 'error', message: 'Check the highlighted field.', fields: { password: 'Enter your password to continue.' } };
}

function passwordRefused(code: string | null): FormState {
  if (code === 'INVALID_PASSWORD') {
    return { status: 'error', message: 'Check the highlighted field.', fields: { password: authMessage('INVALID_PASSWORD') } };
  }
  return { status: 'error', message: authMessage(code) };
}

/** Keeps what Better Auth returned for this browser's account (see the top of this file). */
async function keepForPage({ codes, uri }: { codes?: unknown; uri?: string }): Promise<void> {
  const principal = await getRequestPrincipal();
  if (!principal) return;
  if (Array.isArray(codes)) await keepBackupCodes(principal.user.id, codes.filter((c): c is string => typeof c === 'string'));
  if (uri) await keepPendingSetup(principal.user.id, uri);
}

export async function enableTwoFactorAction(_previous: FormState, form: FormData): Promise<FormState> {
  return formResult({ form: 'enable-two-factor', page: PAGE }, await enableTwoFactor(form));
}

async function enableTwoFactor(form: FormData): Promise<FormState> {
  const password = secretValue(form, 'password', MAX_PASSWORD_LENGTH + 1);
  const missing = passwordMissing(password);
  if (missing) return missing;
  const result = await authAction<{ totpURI?: string; backupCodes?: string[] }>('/two-factor/enable', { body: { password } });
  if (!result.ok || !result.data?.totpURI) return passwordRefused(result.code);
  await keepForPage({ codes: result.data.backupCodes, uri: result.data.totpURI });
  // The page renders the pending setup: QR code, key, link.
  redirect(PAGE);
}

async function verifyCode(form: FormData): Promise<FormState | { ok: true }> {
  const method = textValue(form, 'method') === 'backup' ? 'backup' : 'totp';
  const typed = secretValue(form, 'code', 64).trim();
  const code = method === 'totp' ? typed.replace(/[\s-]/g, '') : typed;
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
  const field = result.code === 'INVALID_CODE' || result.code === 'INVALID_BACKUP_CODE' || result.code === 'CODE_ALREADY_USED';
  return {
    status: 'error',
    message: field ? 'Check the highlighted field.' : authMessage(result.code),
    ...(field ? { fields: { code: authMessage(result.code) } } : {}),
    values,
  };
}

export async function confirmTwoFactorAction(_previous: FormState, form: FormData): Promise<FormState> {
  return formResult({ form: 'confirm-two-factor', page: PAGE }, await confirmTwoFactor(form));
}

async function confirmTwoFactor(form: FormData): Promise<FormState> {
  const outcome = await verifyCode(form);
  if (!('ok' in outcome)) return outcome;
  redirect(`${PAGE}?codes=new`);
}

export async function verifySessionAction(_previous: FormState, form: FormData): Promise<FormState> {
  const next = safeNextPath(textValue(form, 'next'), '');
  return formResult({ form: 'verify-session', page: next ? `${PAGE}?${new URLSearchParams({ next })}` : PAGE }, await verifySession(form, next));
}

async function verifySession(form: FormData, next: string): Promise<FormState> {
  const outcome = await verifyCode(form);
  if (!('ok' in outcome)) return outcome;
  redirect(next || `${PAGE}?verified=1`);
}

export async function newBackupCodesAction(_previous: FormState, form: FormData): Promise<FormState> {
  return formResult({ form: 'new-backup-codes', page: PAGE }, await newBackupCodes(form));
}

async function newBackupCodes(form: FormData): Promise<FormState> {
  const password = secretValue(form, 'password', MAX_PASSWORD_LENGTH + 1);
  const missing = passwordMissing(password);
  if (missing) return missing;
  const result = await authAction<{ backupCodes?: string[] }>('/two-factor/generate-backup-codes', { body: { password } });
  if (!result.ok || !result.data?.backupCodes) return passwordRefused(result.code);
  await keepForPage({ codes: result.data.backupCodes });
  redirect(`${PAGE}?codes=new`);
}

export async function disableTwoFactorAction(_previous: FormState, form: FormData): Promise<FormState> {
  return formResult({ form: 'disable-two-factor', page: PAGE }, await disableTwoFactor(form));
}

async function disableTwoFactor(form: FormData): Promise<FormState> {
  const password = secretValue(form, 'password', MAX_PASSWORD_LENGTH + 1);
  const missing = passwordMissing(password);
  if (missing) return missing;
  const result = await authAction('/two-factor/disable', { body: { password } });
  if (!result.ok) return passwordRefused(result.code);
  redirect(`${PAGE}?off=1`);
}
