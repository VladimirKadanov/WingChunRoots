'use server';

// The Server Action of /admin/billing/[id] (milestone M22): a thin wrapper over billing.testClock
// (src/server/rpc/parity.ts), which requires an admin with a verified second factor and the test
// provider. The clock's events reach the webhook and the worker as a provider's would.

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { TEST_CLOCK_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function moveTestClockAction(_previous: FormState, form: FormData): Promise<FormState> {
  const subscriptionId = textValue(form, 'subscriptionId', 64);
  const step = textValue(form, 'step', 16) as 'period_end' | 'grace_end';
  const page = UUID.test(subscriptionId) ? `/admin/billing/${subscriptionId}` : '/admin/billing';
  let state: FormState;
  try {
    await serverClient(await headers(), await getRequestPrincipal()).billing.testClock({ subscriptionId, step });
    refresh();
    state = {
      status: 'done',
      message: 'The test clock moved. The provider events are on their way; refresh in a few seconds to see them applied.',
    };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    if (rpcErrorCode(error) === 'SECOND_FACTOR_REQUIRED') redirect(`/account/security?next=${encodeURIComponent(page)}`);
    state = formStateFromFailure(error);
  }
  return formResult({ form: TEST_CLOCK_FORM, page, anchor: outcomeTarget(TEST_CLOCK_FORM, state, false) }, state);
}
