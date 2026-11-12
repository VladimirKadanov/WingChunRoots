'use server';

// The Server Actions of /dashboard/succession (milestone M25, In scope 1): thin wrappers over
// succession.nominate, succession.answer, succession.revoke and succession.request
// (src/server/rpc/parity.ts), called in-process with this request's session, so the page and
// /api/v1 run the same checks. The evidence files are uploaded by the page's evidence field to
// POST /api/evidence/upload first (no Server Action carries a file), and removed with the M10a
// action (evidence.discard). Success comes back to the page by an id only (never a name).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ANSWER_FORM, NOMINATE_FORM, REQUEST_FORM, REVOKE_FORM } from './form-ids';

const PAGE = '/dashboard/succession';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

const uuidOr = (value: string) => (UUID.test(value) ? value : '');

function signInAgain(): never {
  redirect(`/sign-in?next=${encodeURIComponent(PAGE)}`);
}

/** A refusal of a form whose only control is its button: a field error is said as the form's message. */
function asMessage(state: FormState): FormState {
  const field = Object.values(state.fields ?? {})[0];
  return field ? { status: 'error', message: field, values: state.values } : state;
}

async function failed(error: unknown, form: string, values: Record<string, string>, single: boolean): Promise<FormState> {
  unstable_rethrow(error);
  if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain();
  const state = single ? asMessage(formStateFromFailure(error, values)) : formStateFromFailure(error, values);
  return formResult({ form, page: PAGE, anchor: outcomeTarget(form, state, single) }, state);
}

/** "Nominate" of one of the owner's verified students (succession.nominate). */
export async function nominateSuccessorAction(_previous: FormState, form: FormData): Promise<FormState> {
  const successorPersonId = textValue(form, 'successorPersonId', 40);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).succession.nominate({ successorPersonId: uuidOr(successorPersonId) });
  } catch (error) {
    return failed(error, NOMINATE_FORM, { successorPersonId }, false);
  }
  redirect(atOutcome(`${PAGE}?nominated=1`));
}

/** "Accept" or "Decline" of a nomination, by the nominee (succession.answer). */
export async function answerNominationAction(_previous: FormState, form: FormData): Promise<FormState> {
  const nominationId = textValue(form, 'nominationId', 40);
  const answer = textValue(form, 'answer', 10);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).succession.answer({
      nominationId: uuidOr(nominationId),
      answer: answer === 'accept' || answer === 'decline' ? answer : ('' as 'accept'),
    });
  } catch (error) {
    return failed(error, ANSWER_FORM, { nominationId }, true);
  }
  redirect(atOutcome(`${PAGE}?answered=${answer === 'accept' ? 'accepted' : 'declined'}`));
}

/** "Revoke the nomination", by the owner (succession.revoke). */
export async function revokeNominationAction(_previous: FormState, form: FormData): Promise<FormState> {
  const nominationId = textValue(form, 'nominationId', 40);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).succession.revoke({ nominationId: uuidOr(nominationId) });
  } catch (error) {
    return failed(error, REVOKE_FORM, { nominationId }, true);
  }
  redirect(atOutcome(`${PAGE}?revoked=1`));
}

/** "Send the request" of an accepted successor, with evidence (succession.request). */
export async function requestSuccessionAction(_previous: FormState, form: FormData): Promise<FormState> {
  const nominationId = textValue(form, 'nominationId', 40);
  const basis = textValue(form, 'basis', 20);
  const note = textValue(form, 'note', 4000);
  const key = textValue(form, 'idempotencyKey', 64);
  const evidenceIds = form
    .getAll('evidenceIds')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 20);
  const values: Record<string, string> = {
    nominationId,
    basis,
    note,
    // The uploaded files come back to the field after a refusal: their ids, names and kinds.
    evidence: JSON.stringify(
      evidenceIds.map((id) => ({ id, name: textValue(form, `evidenceName.${id}`, 200), kindLabel: textValue(form, `evidenceKind.${id}`, 40), sizeBytes: Number(textValue(form, `evidenceSize.${id}`, 12)) || 0 })),
    ),
  };
  let caseId: string;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).succession.request({
      nominationId: uuidOr(nominationId),
      basis: basis === 'reported_death' || basis === 'inactivity' ? basis : ('' as 'inactivity'),
      note,
      evidenceIds,
      idempotencyKey: KEY.test(key) ? key : '',
    });
    caseId = result.request.caseId;
  } catch (error) {
    return failed(error, REQUEST_FORM, values, false);
  }
  redirect(atOutcome(`${PAGE}?requested=${caseId}`));
}
