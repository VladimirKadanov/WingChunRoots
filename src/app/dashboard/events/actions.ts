'use server';

// The Server Actions of the organizer's events (milestone M17, In scope 5 and 6): thin wrappers
// over events.create, events.update and events.cancel (src/server/rpc/parity.ts), called in-process
// with this request's session, so the forms and /api/v1 run the same checks: the plan's allowance
// under its lock, the organizer, the zone. A failure is never rethrown as it is: the form shows the
// procedure's answer, or one calm message. Without JavaScript a failure comes back to the form as
// a kept result (src/server/forms/flash.ts). The poster is uploaded by events.uploadPoster from the
// browser (../../../components/gallery/rpc.tsx), as a gallery photo is.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { EVENT_CANCEL_FORM, EVENT_FORM } from './form-ids';

const LIST = '/dashboard/events';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type EventKind = 'seminar' | 'camp' | 'exam_session' | 'other';

function signInAgain(next: string): never {
  redirect(`/sign-in?next=${encodeURIComponent(next)}`);
}

/** The fields of the event form, as events.create and events.update take them, and the values to show again. */
function readFields(form: FormData) {
  const values: Record<string, string> = {};
  for (const [name, max] of [
    ['title', 320],
    ['kind', 20],
    ['description', 8000],
    ['startsAt', 40],
    ['endsAt', 40],
    ['where', 10],
    ['placeId', 40],
    ['timezone', 80],
    ['venue', 400],
    ['schoolId', 40],
    ['externalUrl', 1200],
    ['organizationId', 40],
  ] as const) {
    const value = textValue(form, name, max);
    if (value) values[name] = value;
  }
  const instructorIds = form
    .getAll('instructorIds')
    .filter((v): v is string => typeof v === 'string' && UUID.test(v))
    .slice(0, 10);
  instructorIds.forEach((id) => (values[`instructor.${id}`] = 'on'));
  const online = values.where === 'online';
  // An unknown kind goes to the procedure as it is: its answer names the field.
  const kind = (values.kind ?? '') as EventKind;
  return {
    input: {
      title: values.title ?? '',
      kind,
      description: values.description ?? null,
      startsAt: values.startsAt ?? '',
      endsAt: values.endsAt ?? '',
      online,
      placeId: online ? null : (values.placeId ?? null),
      timezone: values.timezone ?? null,
      venue: online ? null : (values.venue ?? null),
      schoolId: values.schoolId ?? null,
      externalUrl: values.externalUrl ?? null,
      instructorIds,
    },
    values,
  };
}

/** "Publish the event" of /dashboard/events/new (events.create): then its page in the dashboard. */
export async function createEventAction(_previous: FormState, form: FormData): Promise<FormState> {
  const { input, values } = readFields(form);
  const organizationId = values.organizationId && values.organizationId !== 'self' ? values.organizationId : null;
  let id: string;
  try {
    const result = await serverClient(await headers(), await getRequestPrincipal()).events.create({ ...input, organizationId });
    id = result.id;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(`${LIST}/new`);
    const state = formStateFromFailure(error, values);
    return formResult({ form: EVENT_FORM, page: `${LIST}/new`, anchor: outcomeTarget(EVENT_FORM, state, false) }, state);
  }
  redirect(`${LIST}/${id}?published=1#outcome`);
}

/** "Save changes" of /dashboard/events/<id> (events.update). */
export async function updateEventAction(_previous: FormState, form: FormData): Promise<FormState> {
  const { input, values } = readFields(form);
  const id = textValue(form, 'id', 40);
  const page = UUID.test(id) ? `${LIST}/${id}` : LIST;
  try {
    await serverClient(await headers(), await getRequestPrincipal()).events.update({ ...input, id });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(page);
    const state = formStateFromFailure(error, { ...values, id });
    return formResult({ form: EVENT_FORM, page, anchor: outcomeTarget(EVENT_FORM, state, false) }, state);
  }
  redirect(`${page}?saved=1#outcome`);
}

/** "Cancel the event" (events.cancel): it stays shown as Cancelled, with the note. */
export async function cancelEventAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  const note = textValue(form, 'note', 2000);
  const page = UUID.test(id) ? `${LIST}/${id}` : LIST;
  try {
    await serverClient(await headers(), await getRequestPrincipal()).events.cancel({ id, note: note || null });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') signInAgain(page);
    const state = formStateFromFailure(error, { note });
    return formResult({ form: EVENT_CANCEL_FORM, page, anchor: outcomeTarget(EVENT_CANCEL_FORM, state, false) }, state);
  }
  redirect(`${page}?cancelled=1#outcome`);
}
