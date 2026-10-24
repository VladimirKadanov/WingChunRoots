'use server';

// The Server Actions of /admin/grants (milestone M08, In scope 3): thin wrappers over the
// grants.create, grants.revoke and grants.closeRequest procedures (src/server/rpc/parity.ts). The procedures require an
// admin with a verified second factor, whoever calls them (requireStaff2FA).
//
// A failure never escapes an action (review round 2, recheck-2): a refusal comes back as the
// form's message and field errors, anything unexpected as one calm message (formStateFromFailure),
// already logged by serverClient() in a line without personal data. Rethrown, Next.js would log
// the whole error (with the e-mail address a failed query quotes) and replace the form.

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { formatDay } from '@/lib/dates';
import { keepValues, textValue } from '@/lib/form-data';
import { type FormState, messageId, outcomeTarget } from '@/lib/form-state';
import { safeNextPath } from '@/server/auth/guards';
import { getRequestPrincipal } from '@/server/auth/web';
import type { PlanCode } from '@/server/entitlements/plans';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { CLOSED_REQUEST_MESSAGE, closeRequestForm, CREATE_GRANT_FORM, revokeGrantForm } from './form-ids';

const PAGE = '/admin/grants';
/**
 * A session that lost its second-factor check goes to prove it again, then comes back (security-8):
 * to the pilot request the form answered, if any (review round 2, recheck-7).
 */
function verifySession(requestId = ''): string {
  const back = /^[0-9a-f-]{36}$/.test(requestId) ? `${PAGE}?request=${requestId}` : PAGE;
  return `/account/security?next=${encodeURIComponent(back)}`;
}
const CREATE_FIELDS = ['email', 'planCode', 'source', 'reason', 'startsOn', 'endsOn', 'requestId'] as const;

export async function createGrantAction(_previous: FormState, form: FormData): Promise<FormState> {
  const state = await createGrant(form);
  return formResult({ form: 'create-grant', page: PAGE, anchor: outcomeTarget(CREATE_GRANT_FORM, state, false) }, state);
}

async function createGrant(form: FormData): Promise<FormState> {
  const values = keepValues(form, CREATE_FIELDS);
  try {
    // The caps only bound the work; each is above the procedure's own limit, so over-long input is
    // refused by grants.create (as through /api/v1), never cut into something valid.
    const grant = await serverClient(await headers(), await getRequestPrincipal()).grants.create({
      email: textValue(form, 'email', 400),
      // The procedure checks the values; these only type what the form sent.
      planCode: textValue(form, 'planCode', 40) as PlanCode,
      source: (textValue(form, 'source', 40) || undefined) as 'test_grant' | 'complimentary' | undefined,
      reason: textValue(form, 'reason', 600),
      startsOn: textValue(form, 'startsOn', 16),
      endsOn: textValue(form, 'endsOn', 16),
      requestId: textValue(form, 'requestId', 64),
    });
    refresh();
    const period = grant.endsAt ? `from ${formatDay(grant.startsAt)} to ${formatDay(grant.endsAt)}` : `from ${formatDay(grant.startsAt)}, with no end date`;
    return { status: 'done', message: `${grant.planName} given to ${grant.email} ${period}.` };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fadmin%2Fgrants');
    if (rpcErrorCode(error) === 'SECOND_FACTOR_REQUIRED') redirect(verifySession(values.requestId));
    return formStateFromFailure(error, values);
  }
}

/** The list the form was on (`back`: search, sort and page kept), or the plain page. */
function listPage(value: string): string {
  const path = safeNextPath(value, PAGE);
  return path === PAGE || path.startsWith(`${PAGE}?`) ? path : PAGE;
}

export async function revokeGrantAction(_previous: FormState, form: FormData): Promise<FormState> {
  // Without JavaScript the outcome comes back to the same list, opened at the row's reason or message.
  const state = await revokeGrant(form);
  const anchor = outcomeTarget(revokeGrantForm(textValue(form, 'grantId', 64)), state, true);
  return formResult({ form: 'revoke-grant', page: listPage(textValue(form, 'back', 400)), anchor }, state);
}

async function revokeGrant(form: FormData): Promise<FormState> {
  const values = keepValues(form, ['grantId', 'reason']);
  try {
    const grant = await serverClient(await headers(), await getRequestPrincipal()).grants.revoke({
      grantId: textValue(form, 'grantId', 64),
      reason: textValue(form, 'reason', 600),
    });
    refresh();
    return { status: 'done', message: `${grant.planName} of ${grant.email} revoked. Confirmed links stay confirmed.`, values: { grantId: grant.id } };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fadmin%2Fgrants');
    if (rpcErrorCode(error) === 'SECOND_FACTOR_REQUIRED') redirect(verifySession());
    return formStateFromFailure(error, values);
  }
}

/**
 * "Close request…" of a pilot access request (review round 2, recheck-5): the answer without a plan.
 * The row shows the outcome in place with JavaScript; without it the list comes back with the
 * message above it (the request is no longer listed), or with the row's form open at its reason.
 */
export async function closeRequestAction(_previous: FormState, form: FormData): Promise<FormState> {
  const state = await closeRequest(form);
  const anchor = state.status === 'done' ? messageId(CLOSED_REQUEST_MESSAGE) : outcomeTarget(closeRequestForm(textValue(form, 'requestId', 64)), state, true);
  return formResult({ form: 'close-request', page: listPage(textValue(form, 'back', 400)), anchor }, state);
}

async function closeRequest(form: FormData): Promise<FormState> {
  const values = keepValues(form, ['requestId', 'reason']);
  try {
    const closed = await serverClient(await headers(), await getRequestPrincipal()).grants.closeRequest({
      requestId: textValue(form, 'requestId', 64),
      reason: textValue(form, 'reason', 600),
    });
    // No refresh(): the row keeps this message in place of the request until the page is read again.
    return {
      status: 'done',
      message: `The request of ${closed.email} for ${closed.planName} is closed. The account was told; its plan has not changed.`,
      values: { requestId: closed.id },
    };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fadmin%2Fgrants');
    if (rpcErrorCode(error) === 'SECOND_FACTOR_REQUIRED') redirect(verifySession());
    return formStateFromFailure(error, values);
  }
}
