'use server';

// The Server Actions of the Sifu's schools (milestone M11, In scope 2 and 3): thin wrappers over
// schools.create, schools.update, schools.submit and schools.confirm (src/server/rpc/parity.ts),
// called in-process with this request's session, so the forms and /api/v1 run the same checks. A
// failure is never rethrown as it is: the form shows the procedure's answer, or one calm message.
// Without JavaScript a failure comes back to the form as a kept result (src/server/forms/flash.ts).
//
// Success goes to the school's page in the dashboard with what happened (?saved=1, ?sent=1,
// ?confirmed=1), by the school's id only.
//
// M21: the schedule and fees (schools.updateSchedule) and the answers to trial lesson requests
// (trial.answer, trial.decline, trial.close).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { linkForm } from '../organization/form-ids';
import { SCHEDULE_FORM, SCHOOL_ACTION_FORM, SCHOOL_FORM, trialForm } from './form-ids';

/** M21: the rows of the schedule form at most (the 30 slots a schedule holds, and none more). */
const SCHEDULE_ROWS_MAX = 30;

const LIST = '/dashboard/schools';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const COORDINATE = /^-?\d{1,3}(\.\d{1,8})?$/;

function signInAgain(next: string): never {
  redirect(`/sign-in?next=${encodeURIComponent(next)}`);
}

const pageOf = (id: string | null) => (id ? `${LIST}/${id}` : `${LIST}/new`);

/** The fields of the school form, as schools.create and schools.update take them, and the values to show again. */
function readFields(form: FormData) {
  const values: Record<string, string> = {};
  for (const [name, max] of [
    ['name', 240],
    ['placeId', 40],
    ['locationPrivacy', 20],
    ['lat', 20],
    ['lng', 20],
    ['websiteUrl', 600],
    ['contactEmail', 508],
    ['contactPhone', 80],
    ['description', 4000],
    ['idempotencyKey', 64],
  ] as const) {
    const value = textValue(form, name, max);
    if (value) values[name] = value;
  }
  const formsTaught = form.getAll('formsTaught').filter((v): v is string => typeof v === 'string').slice(0, 12);
  const instructorIds = form
    .getAll('instructorIds')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 40);
  formsTaught.forEach((key) => (values[`forms.${key}`] = 'on'));
  instructorIds.forEach((id) => (values[`instructor.${id}`] = 'on'));
  const lat = values.lat ?? '';
  const lng = values.lng ?? '';
  const point = COORDINATE.test(lat) && COORDINATE.test(lng) ? { lat: Number(lat), lng: Number(lng) } : null;
  return {
    input: {
      name: values.name ?? '',
      placeId: values.placeId ?? '',
      locationPrivacy: (values.locationPrivacy ?? '') as 'exact' | 'city_only',
      point,
      websiteUrl: values.websiteUrl ?? null,
      contactEmail: values.contactEmail ?? null,
      contactPhone: values.contactPhone ?? null,
      description: values.description ?? null,
      formsTaught: formsTaught as never[],
      instructorIds,
    },
    // A typed point that does not parse is the pin's error, as the procedure's own message says.
    badPoint: (lat !== '' || lng !== '') && point === null,
    values,
  };
}

/** A coordinate typed wrong, or a point the procedure refused, is shown at the latitude field. */
function pointField(state: FormState, badPoint: boolean): FormState {
  if (state.status !== 'error') return state;
  const fields = { ...state.fields };
  if (fields.point) {
    fields.lat = fields.point;
    delete fields.point;
  } else if (badPoint) {
    fields.lat = 'Give the latitude and longitude as numbers, like 42.6977 and 23.3219.';
  }
  return { ...state, fields };
}

/** "Save the draft" of /dashboard/schools/new (schools.create). */
export async function createSchoolAction(_previous: FormState, form: FormData): Promise<FormState> {
  const { input, values, badPoint } = readFields(form);
  const key = values.idempotencyKey ?? '';
  let id: string;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).schools.create({ ...input, idempotencyKey: KEY.test(key) ? key : '' });
    id = result.id;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(pageOf(null));
    const state = pointField(formStateFromFailure(error, values), badPoint);
    return formResult({ form: SCHOOL_FORM, page: pageOf(null), anchor: outcomeTarget(SCHOOL_FORM, state, false) }, state);
  }
  redirect(`${LIST}/${id}?saved=1#outcome`);
}

/** "Save changes" of /dashboard/schools/<id>/edit (schools.update): back to the school's page. */
export async function updateSchoolAction(_previous: FormState, form: FormData): Promise<FormState> {
  const { input, values, badPoint } = readFields(form);
  const id = textValue(form, 'id', 40);
  const page = UUID.test(id) ? pageOf(id) : LIST;
  const edit = UUID.test(id) ? `${page}/edit` : LIST;
  try {
    await serverClient(await headers(), await getRequestPrincipal()).schools.update({ ...input, id });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(edit);
    const state = pointField(formStateFromFailure(error, { ...values, id }), badPoint);
    return formResult({ form: SCHOOL_FORM, page: edit, anchor: outcomeTarget(SCHOOL_FORM, state, false) }, state);
  }
  redirect(`${page}?saved=1#outcome`);
}

/** The one-button forms of the listing: "Send for review" (schools.submit) and "This listing is current" (schools.confirm). */
async function listingStep(form: FormData, step: 'submit' | 'confirm'): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  const page = UUID.test(id) ? pageOf(id) : LIST;
  try {
    const client = serverClient(await headers(), await getRequestPrincipal());
    if (step === 'submit') await client.schools.submit({ id });
    else await client.schools.confirm({ id });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(page);
    const state = formStateFromFailure(error, { id });
    // The id is a hidden field: its error is said as the form's message.
    const field = Object.values(state.fields ?? {})[0];
    const shown: FormState = field ? { status: 'error', message: field } : state;
    return formResult({ form: SCHOOL_ACTION_FORM, page, anchor: outcomeTarget(SCHOOL_ACTION_FORM, shown, true) }, shown);
  }
  redirect(`${page}?${step === 'submit' ? 'sent' : 'confirmed'}=1#outcome`);
}

export async function submitSchoolAction(_previous: FormState, form: FormData): Promise<FormState> {
  return listingStep(form, 'submit');
}

export async function confirmSchoolAction(_previous: FormState, form: FormData): Promise<FormState> {
  return listingStep(form, 'confirm');
}

// --- M15: organization links -------------------------------------------------------------------

/** "Accept" or "Refuse" an organization's link (organizations.answerSchoolLink): the school and its pin do not change. */
export async function answerOrganizationLinkAction(_previous: FormState, form: FormData): Promise<FormState> {
  const linkId = textValue(form, 'linkId', 40);
  const answer = textValue(form, 'answer', 10);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).organizations.answerSchoolLink({ linkId, accept: answer === 'accept' ? true : answer === 'refuse' ? false : (answer as unknown as boolean) });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(`${LIST}#organizations`);
    const state = formStateFromFailure(error);
    return formResult({ form: linkForm(linkId), page: LIST, anchor: outcomeTarget(linkForm(linkId), state, true) }, state);
  }
  redirect(`${LIST}?organization=${answer === 'accept' ? 'accepted' : 'refused'}#organizations`);
}

/** "End link" from the school's side (organizations.endSchoolLink). */
export async function endOrganizationLinkAction(_previous: FormState, form: FormData): Promise<FormState> {
  const linkId = textValue(form, 'linkId', 40);
  try {
    await serverClient(await headers(), await getRequestPrincipal()).organizations.endSchoolLink({ linkId });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(`${LIST}#organizations`);
    const state = formStateFromFailure(error);
    return formResult({ form: linkForm(linkId), page: LIST, anchor: outcomeTarget(linkForm(linkId), state, true) }, state);
  }
  redirect(`${LIST}?organization=ended#organizations`);
}

// --- M21: trial lesson requests and the schedule ----------------------------------------------

/**
 * One trial lesson request in the school's inbox: "Answer" (trial.answer, with the reply),
 * "Decline" (trial.decline, with the text as the reason) or "Close" (trial.close), by the button
 * pressed. Back to the inbox with what happened.
 */
export async function decideTrialAction(_previous: FormState, form: FormData): Promise<FormState> {
  const schoolId = textValue(form, 'schoolId', 40);
  const inquiryId = textValue(form, 'inquiryId', 40);
  const decision = textValue(form, 'decision', 10);
  const text = textValue(form, 'reply', 1200);
  const inbox = UUID.test(schoolId) ? `${pageOf(schoolId)}/inquiries` : LIST;
  const formId = trialForm(UUID.test(inquiryId) ? inquiryId : 'none');
  try {
    const client = serverClient(await headers(), await getRequestPrincipal());
    if (decision === 'answer') await client.trial.answer({ inquiryId, reply: text || null });
    else if (decision === 'decline') await client.trial.decline({ inquiryId, reason: text || null });
    else if (decision === 'close') await client.trial.close({ inquiryId });
    else return { status: 'error', message: 'Choose Answer, Decline or Close.' };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(inbox);
    const state = formStateFromFailure(error, text ? { reply: text } : undefined);
    const fields = { ...state.fields };
    if (fields.reason) {
      fields.reply = fields.reason;
      delete fields.reason;
    }
    const hidden = fields.inquiryId;
    delete fields.inquiryId;
    const shown: FormState = state.status === 'error' ? { ...state, fields, ...(hidden ? { message: hidden } : {}) } : state;
    return formResult({ form: formId, page: inbox, anchor: outcomeTarget(formId, shown, true) }, shown);
  }
  redirect(`${inbox}?done=${decision === 'answer' ? 'answered' : decision === 'decline' ? 'declined' : 'closed'}#outcome`);
}

/**
 * "Save the schedule" of /dashboard/schools/<id>/schedule (schools.updateSchedule). The form has
 * rows of day, start, end and label; a row left wholly empty is dropped, and the errors of the rows
 * sent are shown at the rows they came from.
 */
export async function updateScheduleAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  const page = UUID.test(id) ? pageOf(id) : LIST;
  const edit = UUID.test(id) ? `${page}/schedule` : LIST;
  const values: Record<string, string> = {};
  const rows = Math.min(Number.parseInt(textValue(form, 'rows', 4), 10) || 0, SCHEDULE_ROWS_MAX);
  const slots: { weekday: number; startsAt: string; endsAt: string; label: string | null }[] = [];
  // The row each sent slot came from, so an error at slots.<n> goes back to its row.
  const rowOf: number[] = [];
  for (let row = 0; row < rows; row++) {
    const weekday = textValue(form, `slot.${row}.weekday`, 2);
    const startsAt = textValue(form, `slot.${row}.startsAt`, 8);
    const endsAt = textValue(form, `slot.${row}.endsAt`, 8);
    const label = textValue(form, `slot.${row}.label`, 120);
    if (!weekday && !startsAt && !endsAt && !label) continue;
    for (const [name, value] of [
      ['weekday', weekday],
      ['startsAt', startsAt],
      ['endsAt', endsAt],
      ['label', label],
    ] as const) {
      if (value) values[`slot.${row}.${name}`] = value;
    }
    slots.push({ weekday: Number.parseInt(weekday, 10) || 0, startsAt, endsAt, label: label || null });
    rowOf.push(row);
  }
  values.rows = String(rows);
  const fees = textValue(form, 'fees', 1000);
  if (fees) values.fees = fees;
  const firstTrialFree = form.get('firstTrialFree') === 'on';
  if (firstTrialFree) values.firstTrialFree = 'on';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).schools.updateSchedule({ id, slots, fees: fees || null, firstTrialFree });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(edit);
    const state = formStateFromFailure(error, { ...values, id });
    const fields: Record<string, string> = {};
    for (const [key, message] of Object.entries(state.fields ?? {})) {
      const match = /^slots\.(\d+)\.(\w+)$/.exec(key);
      if (match) fields[`slot.${rowOf[Number(match[1])] ?? 0}.${match[2]}`] = message;
      else if (key === 'slots') fields['slot.0.weekday'] = message;
      else if (key === 'id') state.message = message;
      else fields[key] = message;
    }
    const shown: FormState = state.status === 'error' ? { ...state, fields } : state;
    return formResult({ form: SCHEDULE_FORM, page: edit, anchor: outcomeTarget(SCHEDULE_FORM, shown, false) }, shown);
  }
  redirect(`${page}?schedule=1#outcome`);
}
