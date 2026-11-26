'use server';

// "Save the ladder" on /dashboard/students/ladder (role replay 2026-11-25, P2-8, ADR 0072): a thin
// Server Action over passport.setLadder. One rank per line, in order; an empty text clears it.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { LADDER_FORM } from '../form-ids';

const PAGE = '/dashboard/students/ladder';

export async function setLadderAction(_previous: FormState, form: FormData): Promise<FormState> {
  const raw = form.get('steps');
  const text = typeof raw === 'string' ? raw.slice(0, 8000) : '';
  const values = { steps: text };
  try {
    const client = serverClient(await headers(), await getRequestPrincipal());
    await client.passport.setLadder({ steps: text.split(/\r?\n/).slice(0, 60) });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error, values);
    return formResult({ form: LADDER_FORM, page: PAGE, anchor: outcomeTarget(LADDER_FORM, state, false) }, state);
  }
  redirect('/dashboard/students?ladder=1');
}
