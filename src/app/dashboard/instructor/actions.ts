'use server';

// The Server Action of /dashboard/instructor (milestone M10b, In scope 3): a thin wrapper over
// instructor.request (src/server/rpc/parity.ts), called in-process with this request's session.
// The files are uploaded by the evidence field to POST /api/evidence/upload first, and removed
// with the M10a action (evidence.discard).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { INSTRUCTOR_FORM } from './form-ids';

const PAGE = '/dashboard/instructor';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** "Send for verification" (instructor.request). */
export async function requestInstructorAction(_previous: FormState, form: FormData): Promise<FormState> {
  const note = textValue(form, 'note', 4000);
  const key = textValue(form, 'idempotencyKey', 64);
  const evidenceIds = form
    .getAll('evidenceIds')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 20);
  const values: Record<string, string> = {
    note,
    idempotencyKey: key,
    evidence: JSON.stringify(
      evidenceIds.map((id) => ({ id, name: textValue(form, `evidenceName.${id}`, 200), kindLabel: textValue(form, `evidenceKind.${id}`, 40), sizeBytes: Number(textValue(form, `evidenceSize.${id}`, 12)) || 0 })),
    ),
  };
  try {
    await serverClient(await headers(), await getRequestPrincipal()).instructor.request({ note: note || null, evidenceIds, idempotencyKey: KEY.test(key) ? key : '' });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
    const state = formStateFromFailure(error, values);
    return formResult({ form: INSTRUCTOR_FORM, page: PAGE, anchor: outcomeTarget(INSTRUCTOR_FORM, state, false) }, state);
  }
  redirect(atOutcome(`${PAGE}?sent=1`));
}
