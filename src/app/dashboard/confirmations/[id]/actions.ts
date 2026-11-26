'use server';

// The Server Action of /dashboard/confirmations/<id> (role replay 2026-11-25, P3-8, ADR 0067): a
// thin wrapper over claimConfirmations.answer (src/server/rpc/parity.ts), called in-process with
// this request's session.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { CONFIRMATION_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Send the answer" (claimConfirmations.answer). */
export async function answerConfirmationAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  const answer = textValue(form, 'answer', 10);
  const note = textValue(form, 'note', 1000);
  const page = UUID.test(id) ? `/dashboard/confirmations/${id}` : '/dashboard';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).claimConfirmations.answer({
      id,
      answer: answer as 'yes',
      ...(note ? { note } : {}),
    });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { id, answer, note });
    return formResult({ form: CONFIRMATION_FORM, page, anchor: outcomeTarget(CONFIRMATION_FORM, state, true) }, state);
  }
  redirect(atOutcome(`${page}?answered=1`));
}
