'use server';

// The Server Action of /dashboard/cases/<id> (milestone M10b): a thin wrapper over cases.reply
// (src/server/rpc/parity.ts), called in-process with this request's session. Files are added with
// the evidence field (POST /api/evidence/upload?case=<id>).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { APPEAL_FORM, CODE_ADD_FORM, CODE_CONFIRM_FORM, REPLY_FORM, VOUCH_ASK_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** "Send the answer" (cases.reply). */
export async function replyCaseAction(_previous: FormState, form: FormData): Promise<FormState> {
  const caseId = textValue(form, 'caseId', 40);
  const body = textValue(form, 'body', 4000);
  const key = textValue(form, 'idempotencyKey', 64);
  const page = UUID.test(caseId) ? `/dashboard/cases/${caseId}` : '/dashboard/cases';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).cases.reply({ caseId, body, idempotencyKey: KEY.test(key) ? key : '' });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { caseId, body });
    return formResult({ form: REPLY_FORM, page, anchor: outcomeTarget(REPLY_FORM, state, true) }, state);
  }
  redirect(atOutcome(`${page}?replied=1`));
}

/** M25: "Send the appeal" of the case's decision (appeals.create). */
export async function appealDecisionAction(_previous: FormState, form: FormData): Promise<FormState> {
  const caseId = textValue(form, 'caseId', 40);
  const grounds = textValue(form, 'grounds', 4000);
  const key = textValue(form, 'idempotencyKey', 64);
  const page = UUID.test(caseId) ? `/dashboard/cases/${caseId}` : '/dashboard/cases';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).appeals.create({ caseId, grounds, idempotencyKey: KEY.test(key) ? key : '' });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { caseId, grounds });
    return formResult({ form: APPEAL_FORM, page, anchor: outcomeTarget(APPEAL_FORM, state, true) }, state);
  }
  redirect(atOutcome(`${page}?appealed=1`));
}

/** ADR 0088: "Ask them to vouch" on an impersonation report (identity.askVouch). */
export async function askVouchAction(_previous: FormState, form: FormData): Promise<FormState> {
  const caseId = textValue(form, 'caseId', 40);
  const slug = textValue(form, 'slug', 200);
  const kind = textValue(form, 'kind', 10);
  const message = textValue(form, 'message', 1000);
  const page = UUID.test(caseId) ? `/dashboard/cases/${caseId}` : '/dashboard/cases';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).identity.askVouch({ caseId, slug, kind: kind as 'teacher', ...(message ? { message } : {}) });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { caseId, slug, kind, message });
    return formResult({ form: VOUCH_ASK_FORM, page, anchor: outcomeTarget(VOUCH_ASK_FORM, state, true) }, state);
  }
  redirect(atOutcome(`${page}?vouch=1`));
}

/** ADR 0088: "Send the code" or "Make a code" on an impersonation report (identity.addCode). */
export async function addCodeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const caseId = textValue(form, 'caseId', 40);
  const channel = textValue(form, 'channel', 10);
  const target = textValue(form, 'target', 400);
  const page = UUID.test(caseId) ? `/dashboard/cases/${caseId}` : '/dashboard/cases';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).identity.addCode({ caseId, channel: channel as 'email', target });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { caseId, channel, target });
    return formResult({ form: CODE_ADD_FORM, page, anchor: outcomeTarget(CODE_ADD_FORM, state, true) }, state);
  }
  redirect(atOutcome(`${page}?code=${channel === 'page' ? 'page' : 'email'}`));
}

/** ADR 0088: "Confirm the code" of a mailed code (identity.confirmCode). */
export async function confirmCodeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const caseId = textValue(form, 'caseId', 40);
  const codeId = textValue(form, 'codeId', 40);
  const code = textValue(form, 'code', 20);
  const page = UUID.test(caseId) ? `/dashboard/cases/${caseId}` : '/dashboard/cases';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).identity.confirmCode({ codeId, code });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { caseId, codeId, code });
    return formResult({ form: CODE_CONFIRM_FORM, page, anchor: outcomeTarget(CODE_CONFIRM_FORM, state, true) }, state);
  }
  redirect(atOutcome(`${page}?confirmed=1`));
}
