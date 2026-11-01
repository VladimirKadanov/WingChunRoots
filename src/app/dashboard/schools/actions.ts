'use server';

// The Server Actions of the Sifu's schools (milestone M11, In scope 2 and 3): thin wrappers over
// schools.create, schools.update, schools.submit and schools.confirm (src/server/rpc/parity.ts),
// called in-process with this request's session, so the forms and /api/v1 run the same checks. A
// failure is never rethrown as it is: the form shows the procedure's answer, or one calm message.
// Without JavaScript a failure comes back to the form as a kept result (src/server/forms/flash.ts).
//
// Success goes to the school's page in the dashboard with what happened (?saved=1, ?sent=1,
// ?confirmed=1), by the school's id only.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { SCHOOL_ACTION_FORM, SCHOOL_FORM } from './form-ids';

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

/** The one-button forms of the listing: "Send for review" (schools.submit) and "Confirm it is current" (schools.confirm). */
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
