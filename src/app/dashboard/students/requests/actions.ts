'use server';

// The Server Actions of the teacher's side of teacher requests (milestone M09, In scope 3 and 6):
// thin wrappers over relationships.approve and relationships.reject (src/server/rpc/parity.ts),
// called in-process with this request's session, so the table and /api/v1 run the same checks: the
// global lock, the plan's allowance (DEFAULT D06), the cycle, duplicate and self checks all happen
// in the service. A failure is never rethrown as it is (M08 review round 2, recheck-2): the row
// shows the procedure's answer, or one calm message.
//
// Success goes back to the page by the relationship's id only (never a name in an address):
// ?approved=<id> or ?declined=<id>, opened at the note that says it (#outcome, which takes the
// focus: OutcomeNote in src/components/relationships/parts.tsx). A failure comes back to the row,
// with JavaScript as the action's state and without as a kept result opened at the row's message
// (src/server/forms/flash.ts).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { RejectionReason } from '@/server/templates/relationships';
import { APPROVE_FORM, approveForm, REJECT_FORM, rejectForm } from './form-ids';

const PAGE = '/dashboard/students/requests';

function signInAgain(): never {
  redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
}

/** "Approve" of a request (relationships.approve). */
export async function approveRequestAction(_previous: FormState, form: FormData): Promise<FormState> {
  const relationshipId = textValue(form, 'relationshipId', 40);
  let approved: string;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).relationships.approve({
      relationshipId,
      idempotencyKey: textValue(form, 'idempotencyKey', 64),
    });
    approved = result.relationship.id;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain();
    // A refusal at the plan's limit says so and points to the upgrade prompt above the table.
    const values = { relationshipId, ...(rpcErrorCode(error) === 'ENTITLEMENT_REQUIRED' ? { limit: 'reached' } : {}) };
    const state = formStateFromFailure(error, values);
    // The row's one control is the button: a field error is said as the row's message.
    const field = Object.values(state.fields ?? {})[0];
    const shown: FormState = field ? { status: 'error', message: field, values } : state;
    return formResult({ form: APPROVE_FORM, page: PAGE, anchor: outcomeTarget(approveForm(relationshipId), shown, true) }, shown);
  }
  redirect(atOutcome(`${PAGE}?approved=${approved}`));
}

/** "Decline" of a request, with a neutral reason (relationships.reject). */
export async function rejectRequestAction(_previous: FormState, form: FormData): Promise<FormState> {
  const relationshipId = textValue(form, 'relationshipId', 40);
  const reason = textValue(form, 'reason', 40);
  let declined: string;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).relationships.reject({
      relationshipId,
      // The procedure checks the value; this only types what the form sent.
      reason: reason as RejectionReason,
      idempotencyKey: textValue(form, 'idempotencyKey', 64),
    });
    declined = result.relationship.id;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain();
    const state = formStateFromFailure(error, { relationshipId, ...(reason ? { reason } : {}) });
    // Only the reason is a field of the form; anything else is the row's message.
    const fields = state.fields ?? {};
    const shown: FormState =
      Object.keys(fields).length === 0 || fields.reason
        ? { ...state, ...(fields.reason ? { fields: { reason: fields.reason } } : {}) }
        : { status: 'error', message: Object.values(fields)[0], values: state.values };
    return formResult({ form: REJECT_FORM, page: PAGE, anchor: outcomeTarget(rejectForm(relationshipId), shown, true) }, shown);
  }
  redirect(atOutcome(`${PAGE}?declined=${declined}`));
}
