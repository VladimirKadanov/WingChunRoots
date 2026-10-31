'use server';

// The Server Actions of the student's side of teacher requests (milestone M09, In scope 1, 6 and 7):
// thin wrappers over relationships.request, relationships.resubmit, relationships.withdraw and
// relationships.end (src/server/rpc/parity.ts), called in-process with this request's session, so
// the forms and /api/v1 run the same checks. A failure is never rethrown as it is (M08 review
// round 2, recheck-2): the form shows the procedure's answer, or one calm message.
//
// Success goes to the page that shows the outcome, by the relationship's id only (never a name in
// an address): /dashboard/teachers?sent=<id>, ?withdrawn=<id> or ?ended=<id>, opened at the note
// that says it (#outcome, which takes the focus: OutcomeNote in
// src/components/relationships/parts.tsx). A failure comes back to the form, with JavaScript as the
// action's state and without as a kept result (src/server/forms/flash.ts).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { atOutcome } from '@/components/relationships/outcome-id';
import { textValue, ticked } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { END_FORM, endForm, REQUEST_FORM, WITHDRAW_FORM, withdrawForm } from './form-ids';

const TEACHERS = '/dashboard/teachers';
const NEW = '/dashboard/teachers/new';
const MAX_PERIODS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

function signInAgain(next: string): never {
  redirect(`/sign-in?next=${encodeURIComponent(next)}`);
}

/** "2019" or "2019-04" from a year field and an optional month select; null when no year. */
function partialDate(year: string, month: string): string | null {
  if (!year) return null;
  return /^\d{1,2}$/.test(month) ? `${year}-${month.padStart(2, '0')}` : year;
}

/** The text fields of a period in the form, by index. */
const PERIOD_FIELDS = ['fromYear', 'fromMonth', 'toYear', 'toMonth', 'schoolId'] as const;

/** The periods of the request form, and the values to show again after an error. */
function readPeriods(form: FormData) {
  const count = Math.min(Math.max(Number(textValue(form, 'periodCount', 2)) || 1, 1), MAX_PERIODS);
  const values: Record<string, string> = { periodCount: String(count) };
  const periods = Array.from({ length: count }, (_, i) => {
    const field = (name: string) => `periods.${i}.${name}`;
    for (const name of PERIOD_FIELDS) {
      const value = textValue(form, field(name), 40);
      if (value) values[field(name)] = value;
    }
    const ongoing = ticked(form, field('ongoing'));
    if (ongoing) values[field('ongoing')] = 'on';
    const schoolId = textValue(form, field('schoolId'), 40);
    return {
      from: partialDate(textValue(form, field('fromYear'), 4), textValue(form, field('fromMonth'), 2)),
      to: ongoing ? null : partialDate(textValue(form, field('toYear'), 4), textValue(form, field('toMonth'), 2)),
      ongoing,
      schoolId: UUID.test(schoolId) ? schoolId : null,
    };
  });
  return { periods, values };
}

/**
 * The procedure's field errors under the names of the form's own fields: a period's `from` and `to`
 * are typed as a year and a month, and the year field takes the message and the focus.
 */
function formFields(state: FormState): FormState {
  if (state.status !== 'error' || !state.fields) return state;
  const fields: Record<string, string> = {};
  for (const [name, message] of Object.entries(state.fields)) {
    const mapped = name.replace(/^periods\.(\d+)\.from$/, 'periods.$1.fromYear').replace(/^periods\.(\d+)\.to$/, 'periods.$1.toYear');
    fields[mapped === 'periods' ? 'periods.0.fromYear' : mapped] ??= message;
  }
  return { ...state, fields };
}

function requestInput(form: FormData) {
  const { periods, values } = readPeriods(form);
  const teacherId = textValue(form, 'teacherId', 40);
  const lineageId = textValue(form, 'lineageId', 40);
  const displayPrimary = ticked(form, 'displayPrimary');
  const key = textValue(form, 'idempotencyKey', 64);
  // The chosen teacher's name, as the form showed it: shown again after an error.
  for (const name of ['teacherId', 'teacherName', 'teacherLang', 'teacherWhere', 'lineageId', 'idempotencyKey'] as const) {
    const value = textValue(form, name, 300);
    if (value) values[name] = value;
  }
  if (displayPrimary) values.displayPrimary = 'on';
  return {
    input: {
      teacherId,
      lineageId: UUID.test(lineageId) ? lineageId : null,
      periods,
      displayPrimary,
      // The form always sends one; a missing key is refused by the procedure like any bad input.
      idempotencyKey: KEY.test(key) ? key : '',
    },
    values,
  };
}

/** "Send the request" of /dashboard/teachers/new (relationships.request). */
export async function requestTeacherAction(_previous: FormState, form: FormData): Promise<FormState> {
  const { input, values } = requestInput(form);
  let sent: string;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).relationships.request(input);
    sent = result.relationship.id;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(NEW);
    const state = formFields(formStateFromFailure(error, values));
    return formResult({ form: REQUEST_FORM, page: NEW, anchor: outcomeTarget(REQUEST_FORM, state, false) }, state);
  }
  redirect(atOutcome(`${TEACHERS}?sent=${sent}`));
}

/** "Send it again" of /dashboard/teachers/new?resubmit=<id> (relationships.resubmit). */
export async function resubmitRequestAction(_previous: FormState, form: FormData): Promise<FormState> {
  const { input, values } = requestInput(form);
  const relationshipId = textValue(form, 'relationshipId', 40);
  const page = UUID.test(relationshipId) ? `${NEW}?resubmit=${relationshipId}` : NEW;
  let sent: string;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).relationships.resubmit({
      relationshipId,
      lineageId: input.lineageId,
      periods: input.periods,
      displayPrimary: input.displayPrimary,
      idempotencyKey: input.idempotencyKey,
    });
    sent = result.relationship.id;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(page);
    const state = formFields(formStateFromFailure(error, { ...values, relationshipId }));
    return formResult({ form: REQUEST_FORM, page, anchor: outcomeTarget(REQUEST_FORM, state, false) }, state);
  }
  redirect(atOutcome(`${TEACHERS}?sent=${sent}`));
}

/** "Withdraw" of a request on /dashboard/teachers (relationships.withdraw). */
export async function withdrawRequestAction(_previous: FormState, form: FormData): Promise<FormState> {
  const relationshipId = textValue(form, 'relationshipId', 40);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).relationships.withdraw({ relationshipId, idempotencyKey: textValue(form, 'idempotencyKey', 64) });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(TEACHERS);
    const state = formStateFromFailure(error, { relationshipId });
    return formResult({ form: WITHDRAW_FORM, page: TEACHERS, anchor: outcomeTarget(withdrawForm(relationshipId), state, true) }, state);
  }
  redirect(atOutcome(`${TEACHERS}?withdrawn=${relationshipId}`));
}

/**
 * "Mark training as ended" of a confirmed link (relationships.end), on the student's
 * /dashboard/teachers and on the teacher's /dashboard/students/requests (`page`).
 */
export async function endTrainingAction(_previous: FormState, form: FormData): Promise<FormState> {
  const relationshipId = textValue(form, 'relationshipId', 40);
  const page = textValue(form, 'page', 40) === 'students' ? '/dashboard/students/requests' : TEACHERS;
  const endedOn = partialDate(textValue(form, 'endYear', 4), textValue(form, 'endMonth', 2)) ?? '';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).relationships.end({ relationshipId, endedOn, idempotencyKey: textValue(form, 'idempotencyKey', 64) });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(page);
    const state = formStateFromFailure(error, { relationshipId, endYear: textValue(form, 'endYear', 4), endMonth: textValue(form, 'endMonth', 2) });
    // The year field takes the message of the date ("endedOn"); anything else is the form's message.
    const fields = state.fields ?? {};
    const date = fields.endedOn ?? fields.endYear;
    const other = Object.entries(fields).find(([name]) => name !== 'endedOn' && name !== 'endYear')?.[1];
    const shown: FormState = date
      ? { status: 'error', message: state.message, fields: { endYear: date }, values: state.values }
      : other
        ? { status: 'error', message: other, values: state.values }
        : state;
    return formResult({ form: END_FORM, page, anchor: outcomeTarget(endForm(relationshipId), shown, true) }, shown);
  }
  redirect(atOutcome(`${page}?ended=${relationshipId}`));
}
