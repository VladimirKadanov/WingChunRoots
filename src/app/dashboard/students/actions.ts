'use server';

// The Server Actions of /dashboard/students (milestone M19, In scope 2, 6 and 7): a teacher (or an
// admin of the issuing organization) records ranks, examinations and skills, changes or withdraws
// them and marks attendance at past events. Thin wrappers over the passport procedures
// (src/server/rpc/parity.ts), called in-process with this request's session, so the forms and
// /api/v1 run the same checks: never the student's own passport, a relationship in arbitration
// read only. A failure comes back to its form (without JavaScript as a kept result,
// src/server/forms/flash.ts).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ATTENDANCE_FORM, ENTRY_FORM, EXAM_FORM, RANK_FORM, SKILL_FORM, WITHDRAW_FORM } from './form-ids';

const LIST = '/dashboard/students';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrEmpty = (value: string) => (UUID.test(value) ? value : '');
const uuidOrNull = (value: string) => (UUID.test(value) ? value : null);

/** The student's page: /dashboard/students?student=<person id>. */
// Always with a query, since callers append `&recorded=…` and the like.
const pageOf = (personId: string) => (UUID.test(personId) ? `${LIST}?student=${personId}` : `${LIST}?`);

function signInAgain(next: string): never {
  redirect(`/sign-in?next=${encodeURIComponent(next)}`);
}

async function client() {
  return serverClient(await headers(), await getRequestPrincipal());
}

async function failed(error: unknown, form: string, page: string, values: Record<string, string>, rename: Record<string, string> = {}): Promise<FormState> {
  unstable_rethrow(error);
  if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(page);
  const state = formStateFromFailure(error, values);
  // A field the procedure names otherwise than the form (the entry's title) points at the form's own.
  if (state.status === 'error' && state.fields) {
    state.fields = Object.fromEntries(Object.entries(state.fields).map(([name, text]) => [rename[name] ?? name, text]));
  }
  return formResult({ form, page, anchor: outcomeTarget(form, state, false) }, state);
}

/** "Record the rank" (passport.addRank). */
export async function addRankAction(_previous: FormState, form: FormData): Promise<FormState> {
  const personId = textValue(form, 'personId', 40);
  const values = { rank: textValue(form, 'rank', 240), date: textValue(form, 'date', 20), organizationId: textValue(form, 'organizationId', 40) };
  try {
    await (await client()).passport.addRank({ personId: uuidOrEmpty(personId), rank: values.rank, date: values.date || null, organizationId: uuidOrNull(values.organizationId) });
  } catch (error) {
    return failed(error, RANK_FORM, pageOf(personId), values);
  }
  redirect(`${pageOf(personId)}&recorded=rank#entries`);
}

/** "Record the examination" (passport.addExam). */
export async function addExamAction(_previous: FormState, form: FormData): Promise<FormState> {
  const personId = textValue(form, 'personId', 40);
  const values = {
    awardedRank: textValue(form, 'awardedRank', 240),
    date: textValue(form, 'date', 20),
    examinerPersonId: textValue(form, 'examinerPersonId', 40),
    organizationId: textValue(form, 'organizationId', 40),
  };
  try {
    await (await client()).passport.addExam({
      personId: uuidOrEmpty(personId),
      awardedRank: values.awardedRank,
      date: values.date || null,
      examinerPersonId: uuidOrNull(values.examinerPersonId),
      organizationId: uuidOrNull(values.organizationId),
    });
  } catch (error) {
    return failed(error, EXAM_FORM, pageOf(personId), values);
  }
  redirect(`${pageOf(personId)}&recorded=exam#entries`);
}

/** "Record the form or skill" (passport.addSkill). */
export async function addSkillAction(_previous: FormState, form: FormData): Promise<FormState> {
  const personId = textValue(form, 'personId', 40);
  const values = { name: textValue(form, 'name', 240), progress: textValue(form, 'progress', 20), date: textValue(form, 'date', 20), organizationId: textValue(form, 'organizationId', 40) };
  try {
    await (await client()).passport.addSkill({
      personId: uuidOrEmpty(personId),
      name: values.name,
      progress: values.progress === 'approved' ? 'approved' : 'learning',
      date: values.date || null,
      organizationId: uuidOrNull(values.organizationId),
    });
  } catch (error) {
    return failed(error, SKILL_FORM, pageOf(personId), values);
  }
  redirect(`${pageOf(personId)}&recorded=skill#entries`);
}

/** "Save" of a changed entry, or "Mark as approved" of a skill (passport.updateEntry). */
export async function updateEntryAction(_previous: FormState, form: FormData): Promise<FormState> {
  const personId = textValue(form, 'personId', 40);
  const id = textValue(form, 'id', 40);
  const kindText = textValue(form, 'kind', 20);
  const kind = kindText === 'exam' || kindText === 'skill' ? kindText : 'rank';
  const values: Record<string, string> = { id, kind };
  const input: Record<string, unknown> = { kind, id: uuidOrEmpty(id) };
  // Only the fields the form sent: "Mark as approved" sends the progress alone.
  for (const field of ['title', 'date', 'progress'] as const) {
    if (!form.has(field)) continue;
    const value = textValue(form, field, field === 'title' ? 240 : 20);
    values[field] = value;
    if (field === 'title') input[kind === 'rank' ? 'rank' : kind === 'exam' ? 'awardedRank' : 'name'] = value;
    else if (field === 'date') input.date = value || null;
    else if (kind === 'skill') input.progress = value === 'approved' ? 'approved' : 'learning';
  }
  try {
    await (await client()).passport.updateEntry(input as Parameters<Awaited<ReturnType<typeof client>>['passport']['updateEntry']>[0]);
  } catch (error) {
    return failed(error, ENTRY_FORM, `${pageOf(personId)}&edit=${uuidOrEmpty(id)}`, values, { rank: 'title', awardedRank: 'title', name: 'title' });
  }
  redirect(`${pageOf(personId)}&changed=1#entry-${uuidOrEmpty(id)}`);
}

/** "Withdraw" (passport.withdrawEntry): kept, shown to nobody. */
export async function withdrawEntryAction(_previous: FormState, form: FormData): Promise<FormState> {
  const personId = textValue(form, 'personId', 40);
  const id = textValue(form, 'id', 40);
  const kindText = textValue(form, 'kind', 20);
  const kind = kindText === 'exam' || kindText === 'skill' || kindText === 'attendance' ? kindText : 'rank';
  try {
    await (await client()).passport.withdrawEntry({ kind, id: uuidOrEmpty(id) });
  } catch (error) {
    return failed(error, WITHDRAW_FORM, pageOf(personId), { id, kind });
  }
  redirect(`${pageOf(personId)}&withdrawn=1#entries`);
}

/** "Mark as attended" (passport.markAttendance) of a past event, for the student of the page. */
export async function markAttendanceAction(_previous: FormState, form: FormData): Promise<FormState> {
  const personId = textValue(form, 'personId', 40);
  const eventId = textValue(form, 'eventId', 40);
  try {
    await (await client()).passport.markAttendance({ eventId: uuidOrEmpty(eventId), personIds: [uuidOrEmpty(personId)] });
  } catch (error) {
    return failed(error, ATTENDANCE_FORM, pageOf(personId), { eventId });
  }
  redirect(`${pageOf(personId)}&attended=1#events`);
}
