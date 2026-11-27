'use server';

// The Server Action of /dashboard/vouches/<id> (ADR 0089): a thin wrapper over
// identityVouches.answer (src/server/rpc/parity.ts), called in-process with this request's session.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { VOUCH_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Send the answer" (identityVouches.answer). */
export async function answerVouchAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  const answer = textValue(form, 'answer', 10);
  const note = textValue(form, 'note', 1000);
  const page = UUID.test(id) ? `/dashboard/vouches/${id}` : '/dashboard';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).identityVouches.answer({
      id,
      answer: answer as 'yes',
      ...(note ? { note } : {}),
    });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { id, answer, note });
    return formResult({ form: VOUCH_FORM, page, anchor: outcomeTarget(VOUCH_FORM, state, true) }, state);
  }
  redirect(atOutcome(`${page}?answered=1`));
}
