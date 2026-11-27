'use server';

// The Server Action of /dashboard/naming (review 2026-11-13, docs/adr/0088-review-1113-leftovers.md):
// a thin wrapper over naming.answer (src/server/rpc/parity.ts), called in-process with this
// request's session. Back to the list with what happened.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { namingForm } from './form-ids';

const PAGE = '/dashboard/naming';

/** "Accept" or "Decline" (naming.answer), by the button pressed. */
export async function answerNamingAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  const answer = textValue(form, 'answer', 10);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).naming.answer({ id, accept: answer === 'accept' ? true : answer === 'decline' ? false : (answer as unknown as boolean) });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error);
    return formResult({ form: namingForm(id), page: PAGE, anchor: outcomeTarget(namingForm(id), state, true) }, state);
  }
  redirect(`${PAGE}?answered=${answer === 'accept' ? 'accepted' : 'declined'}#requests`);
}
