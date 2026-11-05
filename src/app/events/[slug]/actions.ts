'use server';

// The Server Action of an event's page (milestone M17, In scope 3): "Remove the event", for staff
// with a verified second factor, a thin wrapper over events.remove (src/server/rpc/parity.ts),
// called in-process with this request's session. The reason is kept in the audit log, never shown.
// Without JavaScript a failure comes back to the form as a kept result (src/server/forms/flash.ts).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { EVENT_REMOVE_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "Remove the event" (events.remove): then the calendar, where the event is gone. */
export async function removeEventAction(_previous: FormState, form: FormData): Promise<FormState> {
  const id = textValue(form, 'id', 40);
  const slug = textValue(form, 'slug', 200);
  const reason = textValue(form, 'reason', 2000);
  const page = SLUG.test(slug) ? `/events/${slug}` : '/events';
  try {
    await serverClient(await headers(), await getRequestPrincipal()).events.remove({ id: UUID.test(id) ? id : '', reason });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, { reason });
    return formResult({ form: EVENT_REMOVE_FORM, page, anchor: outcomeTarget(EVENT_REMOVE_FORM, state, false) }, state);
  }
  redirect('/events?removed=1');
}
