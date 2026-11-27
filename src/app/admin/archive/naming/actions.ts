'use server';

// The Server Action of /admin/archive/naming (review 2026-11-13, docs/adr/0088-review-1113-leftovers.md):
// a thin wrapper over naming.review (src/server/rpc/parity.ts), called in-process with this
// request's session (an archivist or an administrator with a verified second factor). A refusal
// comes back in the control panel's language (../labels.ts).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { getAdminT } from '@/components/admin/i18n/server';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { translateFormState } from '../labels';
import { reviewNamingForm } from './form-ids';

const PAGE = '/admin/archive/naming';

/** "Approve" or "Decline" (naming.review), by the button pressed, with the optional reason. */
export async function reviewNamingAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  const decision = textValue(form, 'decision', 10);
  const reason = textValue(form, 'reason', 500);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).naming.review({
      id,
      approve: decision === 'approve' ? true : decision === 'decline' ? false : (decision as unknown as boolean),
      ...(reason ? { reason } : {}),
    });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = translateFormState(await getAdminT(), formStateFromFailure(error, { id, reason }));
    return formResult({ form: reviewNamingForm(id), page: PAGE, anchor: outcomeTarget(reviewNamingForm(id), state, true) }, state);
  }
  redirect(`${PAGE}?decided=${decision === 'approve' ? 'approved' : 'declined'}#requests`);
}
