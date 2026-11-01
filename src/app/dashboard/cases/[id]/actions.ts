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
import { REPLY_FORM } from './form-ids';

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
