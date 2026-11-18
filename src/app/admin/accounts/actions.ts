'use server';

// The Server Actions of /admin/accounts (review 2026-11; docs/adr/0030-takedown-suspension-erasure.md):
// thin wrappers over the accounts.suspend, accounts.unsuspend and accounts.erase procedures
// (src/server/rpc/parity.ts). The procedures require an administrator with a verified second factor,
// whoever calls them (requireStaff2FA). A failure never escapes an action: a refusal comes back as the
// form's message and field errors, anything unexpected as one calm message (formStateFromFailure).

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { keepValues, textValue, ticked } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ERASE_FORM, SUSPEND_FORM, unsuspendForm } from './form-ids';

const PAGE = '/admin/accounts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A session that lost its second-factor check goes to prove it again, then comes back. */
const VERIFY = `/account/security?next=${encodeURIComponent(PAGE)}`;
const SIGN_IN = `/sign-in?next=${encodeURIComponent(PAGE)}`;

/**
 * A refusal's message and field errors in the control panel's language (docs/adr/0043-admin-bulgarian.md):
 * the service's English text is the key (BG_ACCOUNTS).
 */
function inLanguage(t: AdminT, state: FormState): FormState {
  return {
    ...state,
    ...(state.message ? { message: t(state.message) } : {}),
    ...(state.fields ? { fields: Object.fromEntries(Object.entries(state.fields).map(([name, text]) => [name, t(text)])) } : {}),
  };
}

/**
 * The end of a suspension as the form gives it, a day: from 00:00 UTC that day. Anything else is
 * passed on as it is, and the procedure refuses it with a message under the field.
 */
function untilOf(value: string): string | undefined {
  if (!value) return undefined;
  return DAY.test(value) ? `${value}T00:00:00Z` : value;
}

export async function suspendAction(_previous: FormState, form: FormData): Promise<FormState> {
  const state = await suspend(form);
  return formResult({ form: 'suspend-account', page: PAGE, anchor: outcomeTarget(SUSPEND_FORM, state, false) }, state);
}

async function suspend(form: FormData): Promise<FormState> {
  const values = keepValues(form, ['email', 'reason', 'until']);
  const t = await getAdminT();
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).accounts.suspend({
      email: textValue(form, 'email', 400),
      reason: textValue(form, 'reason', 4000),
      until: untilOf(textValue(form, 'until', 40)),
    });
    refresh();
    const email = values.email;
    const suspended = result.until
      ? email
        ? t('{email} is suspended until {date}.', { email, date: t.day(result.until) })
        : t('The account is suspended until {date}.', { date: t.day(result.until) })
      : email
        ? t('{email} is suspended until an administrator lifts it.', { email })
        : t('The account is suspended until an administrator lifts it.');
    return {
      status: 'done',
      message: `${suspended} ${t.n(result.sessionsEnded, '{n} session ended.', '{n} sessions ended.')} ${t('The person was not told.')}`,
    };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(SIGN_IN);
    if (rpcErrorCode(error) === 'SECOND_FACTOR_REQUIRED') redirect(VERIFY);
    return inLanguage(t, formStateFromFailure(error, values));
  }
}

export async function unsuspendAction(_previous: FormState, form: FormData): Promise<FormState> {
  const state = await unsuspend(form);
  return formResult({ form: 'unsuspend-account', page: PAGE, anchor: outcomeTarget(unsuspendForm(textValue(form, 'userId', 64)), state, true) }, state);
}

async function unsuspend(form: FormData): Promise<FormState> {
  const values = keepValues(form, ['userId', 'reason']);
  const userId = textValue(form, 'userId', 64);
  const t = await getAdminT();
  try {
    await serverClient(await headers(), await getRequestPrincipal()).accounts.unsuspend({
      userId: UUID.test(userId) ? userId : undefined,
      reason: textValue(form, 'reason', 4000),
    });
    refresh();
    return { status: 'done', message: t('The suspension is lifted. The person can sign in again.'), values: { userId } };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(SIGN_IN);
    if (rpcErrorCode(error) === 'SECOND_FACTOR_REQUIRED') redirect(VERIFY);
    return inLanguage(t, formStateFromFailure(error, values));
  }
}

export async function eraseAction(_previous: FormState, form: FormData): Promise<FormState> {
  const state = await erase(form);
  return formResult({ form: 'erase-account', page: PAGE, anchor: outcomeTarget(ERASE_FORM, state, false) }, state);
}

async function erase(form: FormData): Promise<FormState> {
  const values = keepValues(form, ['email', 'caseId', 'reason'], ['confirm']);
  const caseId = textValue(form, 'caseId', 64);
  const t = await getAdminT();
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).accounts.erase({
      ...(UUID.test(caseId) ? { caseId } : { email: textValue(form, 'email', 400) }),
      reason: textValue(form, 'reason', 4000),
      // The procedure refuses anything but true; a box left empty is sent as the refusal it is.
      confirm: ticked(form, 'confirm') ? true : (false as unknown as true),
    });
    refresh();
    const profile = result.personId
      ? ` ${result.visibility === 'public' ? t('Its profile stays as an unclaimed record (public).') : t('Its profile stays as an unclaimed record (private).')}`
      : '';
    const withdrawn =
      result.requestsWithdrawn > 0 ? ` ${t.n(result.requestsWithdrawn, '{n} pending request was withdrawn.', '{n} pending requests were withdrawn.')}` : '';
    return { status: 'done', message: `${t('The account is erased.')}${profile}${withdrawn}` };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(SIGN_IN);
    if (rpcErrorCode(error) === 'SECOND_FACTOR_REQUIRED') redirect(VERIFY);
    return inLanguage(t, formStateFromFailure(error, values));
  }
}
