'use server';

// The Server Action of /schools/<slug>/trial (M21, docs/adr/0024-trial-lessons.md): a thin wrapper
// over trial.request (src/server/rpc/parity.ts), called in-process with this request's session, so
// the form and /api/v1 run the same checks. A sent request goes to the sender's list
// (/dashboard/trial-lessons?sent=1); a refusal stays on the form with what was typed. Without
// JavaScript a refusal comes back as a kept result (src/server/forms/flash.ts).

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { TRIAL_REQUEST_FORM } from './form-ids';

const SLUG = /^[a-z0-9-]{1,120}$/;

/** "Send the request" (trial.request). */
export async function requestTrialAction(_previous: FormState, form: FormData): Promise<FormState> {
  const slugValue = textValue(form, 'slug', 120);
  const page = SLUG.test(slugValue) ? `/schools/${slugValue}/trial` : '/schools';
  const values: Record<string, string> = {};
  for (const [name, max] of [
    ['schoolId', 40],
    ['contactMethod', 10],
    ['phone', 80],
    ['preferredTimes', 400],
    ['message', 2000],
  ] as const) {
    const value = textValue(form, name, max);
    if (value) values[name] = value;
  }
  try {
    await serverClient(await headers(), await getRequestPrincipal()).trial.request({
      schoolId: values.schoolId ?? '',
      contactMethod: (values.contactMethod ?? '') as 'email' | 'phone',
      phone: values.phone ?? null,
      preferredTimes: values.preferredTimes ?? null,
      message: values.message ?? null,
    });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, values);
    // The school's id is a hidden field: its error is said as the form's message.
    const fields = { ...state.fields };
    const hidden = fields.schoolId;
    delete fields.schoolId;
    const shown: FormState = state.status === 'error' && hidden ? { ...state, message: hidden, fields } : state;
    return formResult({ form: TRIAL_REQUEST_FORM, page, anchor: outcomeTarget(TRIAL_REQUEST_FORM, shown, false) }, shown);
  }
  redirect('/dashboard/trial-lessons?sent=1#outcome');
}
