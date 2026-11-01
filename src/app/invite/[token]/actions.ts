'use server';

// The Server Action of /invite/<token> (milestone M10b, In scope 2): a thin wrapper over
// invitations.accept (src/server/rpc/parity.ts), called in-process with this request's session.
// The token travels in the form's body, as it does to the API. Success opens the claim's case page,
// by its id only.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ACCEPT_FORM } from './form-ids';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** "Claim this profile" (invitations.accept). */
export async function acceptInvitationAction(_previous: FormState, form: FormData): Promise<FormState> {
  const token = textValue(form, 'token', 100);
  const note = textValue(form, 'note', 4000);
  const key = textValue(form, 'idempotencyKey', 64);
  const page = TOKEN.test(token) ? `/invite/${token}` : '/';
  let caseId: string;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).invitations.accept({ token, note: note || null, idempotencyKey: KEY.test(key) ? key : '' });
    caseId = result.caseId;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { note });
    return formResult({ form: ACCEPT_FORM, page, anchor: outcomeTarget(ACCEPT_FORM, state, true) }, state);
  }
  redirect(atOutcome(`/dashboard/cases/${caseId}?claimed=1`));
}
