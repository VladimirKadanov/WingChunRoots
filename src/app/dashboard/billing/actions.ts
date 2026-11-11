'use server';

// The Server Actions of /dashboard/billing (milestone M22; docs/adr/0025-billing.md): thin wrappers
// over billing.checkout, billing.cancel and billing.resume (src/server/rpc/parity.ts). The
// procedures check who may act on which subscription, whoever calls them. A refusal comes back as
// the form's message; anything unexpected as one calm message, never rethrown (formStateFromFailure).

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { formatDay } from '@/lib/dates';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import type { PlanCode } from '@/server/entitlements/plans';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { CANCEL_FORM, CHECKOUT_FORM, RESUME_FORM } from './form-ids';

const PAGE = '/dashboard/billing';
const SIGN_IN = '/sign-in?next=%2Fdashboard%2Fbilling';

/** "Choose this plan": starts a test-mode checkout and sends the browser to its page. */
export async function startCheckoutAction(_previous: FormState, form: FormData): Promise<FormState> {
  const planCode = textValue(form, 'planCode', 40) as PlanCode;
  const interval = (textValue(form, 'interval', 8) || 'month') as 'month' | 'year';
  let url: string;
  try {
    url = (await serverClient(await headers(), await getRequestPrincipal()).billing.checkout({ planCode, interval })).url;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(SIGN_IN);
    const state = formStateFromFailure(error, { planCode });
    return formResult({ form: CHECKOUT_FORM, page: PAGE, anchor: outcomeTarget(CHECKOUT_FORM, state, false) }, state);
  }
  // The test checkout page of the app, or the provider's own page (Stripe test mode): only an
  // address the procedure gave, which is a path of this app or an https page of the provider.
  const safe = (url.startsWith('/') && !url.startsWith('//')) || url.startsWith('https://checkout.stripe.com/');
  redirect(safe ? url : PAGE);
}

export async function cancelSubscriptionAction(_previous: FormState, form: FormData): Promise<FormState> {
  const state = await change(form, 'cancel');
  return formResult({ form: CANCEL_FORM, page: PAGE, anchor: outcomeTarget(CANCEL_FORM, state, false) }, state);
}

export async function resumeSubscriptionAction(_previous: FormState, form: FormData): Promise<FormState> {
  const state = await change(form, 'resume');
  return formResult({ form: RESUME_FORM, page: PAGE, anchor: outcomeTarget(RESUME_FORM, state, false) }, state);
}

async function change(form: FormData, what: 'cancel' | 'resume'): Promise<FormState> {
  const subscriptionId = textValue(form, 'subscriptionId', 64);
  try {
    const client = serverClient(await headers(), await getRequestPrincipal());
    const sub = what === 'cancel' ? await client.billing.cancel({ subscriptionId }) : await client.billing.resume({ subscriptionId });
    refresh();
    return {
      status: 'done',
      message:
        what === 'cancel'
          ? `${sub.planName} is cancelled at the end of the period. You keep it until ${formatDay(sub.currentPeriodEnd)}, and nothing you added is deleted.`
          : `${sub.planName} renews again on ${formatDay(sub.currentPeriodEnd)}.`,
    };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(SIGN_IN);
    return formStateFromFailure(error);
  }
}
