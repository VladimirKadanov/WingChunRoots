'use server';

// The Server Actions of the review queue (milestone M10a, In scope 4 and 5): thin wrappers over
// review.assign, review.decide, review.note and archive.update (src/server/rpc/parity.ts), called
// in-process with this request's session, so the forms and /api/v1 run the same checks (the
// second factor, the roles, the assignment). Each mutation carries an idempotency key the page
// made for it, except the archival edit, which writes nothing when nothing changed. A failure
// comes back to its form; success reloads the case card or the record, which shows the outcome.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ARCHIVE_FORM, ASSIGN_FORM, DECIDE_FORM, NOTE_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const SLUG = /^[a-z0-9-]{1,120}$/;

const casePage = (id: string) => (UUID.test(id) ? `/admin/review/${id}` : '/admin/review');
const key = (form: FormData) => {
  const value = textValue(form, 'idempotencyKey', 64);
  return KEY.test(value) ? value : '';
};

async function client() {
  return serverClient(await headers(), await getRequestPrincipal());
}

function signInAgain(page: string): never {
  redirect(`/sign-in?next=${encodeURIComponent(page)}`);
}

/** "Assign to me", "Unassign" and an administrator's "Assign" (review.assign). */
export async function assignCaseAction(_previous: FormState, form: FormData): Promise<FormState> {
  const caseId = textValue(form, 'caseId', 40);
  const assignee = textValue(form, 'assigneeId', 40);
  const page = casePage(caseId);
  try {
    await (await client()).review.assign({ caseId, assigneeId: UUID.test(assignee) ? assignee : null, idempotencyKey: key(form) });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(page);
    const state = formStateFromFailure(error, { caseId });
    return formResult({ form: ASSIGN_FORM, page, anchor: outcomeTarget(ASSIGN_FORM, state, true) }, state);
  }
  redirect(`${page}?done=${UUID.test(assignee) ? 'assigned' : 'unassigned'}#case-outcome`);
}

/** "Verify", "Refuse" and "Ask for more information" (review.decide). */
export async function decideCaseAction(_previous: FormState, form: FormData): Promise<FormState> {
  const caseId = textValue(form, 'caseId', 40);
  const decision = textValue(form, 'decision', 20);
  const reason = textValue(form, 'reason', 4000);
  const page = casePage(caseId);
  try {
    await (await client()).review.decide({
      caseId,
      decision: decision === 'verify' || decision === 'reject' || decision === 'needs_info' ? decision : ('' as 'verify'),
      reason: reason || null,
      idempotencyKey: key(form),
    });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(page);
    const state = formStateFromFailure(error, { caseId, decision, reason });
    return formResult({ form: `${DECIDE_FORM}-${decision}`, page, anchor: outcomeTarget(`${DECIDE_FORM}-${decision}`, state, true) }, state);
  }
  redirect(`${page}?done=${decision === 'verify' ? 'verified' : decision === 'reject' ? 'refused' : 'asked'}#case-outcome`);
}

/** "Add the note" (review.note): an internal note, for reviewers only. */
export async function addNoteAction(_previous: FormState, form: FormData): Promise<FormState> {
  const caseId = textValue(form, 'caseId', 40);
  const body = textValue(form, 'body', 4000);
  const page = casePage(caseId);
  try {
    await (await client()).review.note({ caseId, body, idempotencyKey: key(form) });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(page);
    const state = formStateFromFailure(error, { caseId, body });
    return formResult({ form: NOTE_FORM, page, anchor: outcomeTarget(NOTE_FORM, state, true) }, state);
  }
  redirect(`${page}?done=noted#notes`);
}

/** "Save the record" of the archival edit (archive.update; an archivist only). */
export async function archiveUpdateAction(_previous: FormState, form: FormData): Promise<FormState> {
  const values: Record<string, string> = {};
  for (const name of ['personId', 'slug', 'primaryName', 'originalName', 'originalLang', 'lifeStatus', 'bio', 'reason'] as const) {
    const value = textValue(form, name, name === 'bio' || name === 'reason' ? 4000 : 300);
    if (value) values[name] = value;
  }
  const evidenceIds = form
    .getAll('evidenceIds')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 20);
  const slug = SLUG.test(values.slug ?? '') ? values.slug! : '';
  const page = slug ? `/admin/review/records/${slug}` : '/admin/review';
  let changed = false;
  try {
    const result = await (await client()).archive.update({
      personId: values.personId ?? '',
      primaryName: values.primaryName ?? '',
      originalName: values.originalName ?? null,
      originalLang: values.originalLang ?? null,
      lifeStatus: values.lifeStatus === 'living' || values.lifeStatus === 'deceased' ? values.lifeStatus : 'unknown',
      bio: values.bio ?? null,
      reason: values.reason ?? '',
      evidenceIds,
    });
    changed = result.changed;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(page);
    const state = formStateFromFailure(error, values);
    return formResult({ form: ARCHIVE_FORM, page, anchor: outcomeTarget(ARCHIVE_FORM, state, false) }, state);
  }
  redirect(`${page}?done=${changed ? 'saved' : 'unchanged'}#record-outcome`);
}
