'use server';

// The Server Action of /dashboard/events/attendance (owner decision 2026-11-18,
// docs/adr/0046-passport-extras.md): a thin wrapper over passport.decideAttendance
// (src/server/rpc/parity.ts), called in-process with this request's session, so the page and
// /api/v1 run the same checks. Without JavaScript a failure comes back as a kept result.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ATTENDANCE_DECIDE_FORM } from './form-ids';

const PAGE = '/dashboard/events/attendance';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Confirm" or "Refuse" (passport.decideAttendance). */
export async function decideAttendanceAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  const decision = textValue(form, 'decision', 10) === 'refuse' ? 'refuse' : 'approve';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).passport.decideAttendance({ id: UUID.test(id) ? id : '', decision });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error, { id, decision });
    return formResult({ form: ATTENDANCE_DECIDE_FORM, page: PAGE, anchor: outcomeTarget(ATTENDANCE_DECIDE_FORM, state, true) }, state);
  }
  redirect(`${PAGE}?${decision === 'approve' ? 'confirmed' : 'refused'}=1`);
}
