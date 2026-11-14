'use server';

// The Server Action of /dashboard/trial-lessons (review 2026-11, docs/adr/0032-retention-and-withdrawal.md):
// "Withdraw request", a thin wrapper over trial.withdraw (src/server/rpc/parity.ts), called in-process
// with this request's session, so the form and /api/v1 run the same checks. A failure is never
// rethrown as it is: the form shows the procedure's answer, or one calm message. Without JavaScript a
// failure comes back to the form as a kept result (src/server/forms/flash.ts).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { withdrawForm } from './form-ids';

const PAGE = '/dashboard/trial-lessons';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Withdraw request": the sender takes back an open request; their name, contact and message are removed at once. */
export async function withdrawTrialAction(_previous: FormState, form: FormData): Promise<FormState> {
  const inquiryId = textValue(form, 'inquiryId', 40);
  const formId = withdrawForm(UUID.test(inquiryId) ? inquiryId : 'none');
  try {
    await serverClient(await headers(), await getRequestPrincipal()).trial.withdraw({ inquiryId });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error);
    // The one field of the form is hidden: its error is the form's message.
    const fields = { ...state.fields };
    const hidden = fields.inquiryId;
    delete fields.inquiryId;
    const shown: FormState = state.status === 'error' ? { ...state, fields, ...(hidden ? { message: hidden } : {}) } : state;
    return formResult({ form: formId, page: PAGE, anchor: outcomeTarget(formId, shown, true) }, shown);
  }
  redirect(`${PAGE}?withdrawn=1#outcome`);
}
