'use server';

// The Server Actions of /dashboard/billing (milestone M22; docs/adr/0025-billing.md): thin wrappers
// over billing.checkout, billing.cancel and billing.resume (src/server/rpc/parity.ts). The
// procedures check who may act on which subscription, whoever calls them. A refusal comes back as
// the form's message; anything unexpected as one calm message, never rethrown (formStateFromFailure).
//
// M23 (docs/adr/0026-federation-billing.md): the same forms serve an organization's billing page
// (/dashboard/organization/<id>/billing): the form names the organization, and the action answers
// on that page; and billing.changePlan and billing.cancelChange change the plan or billing period.

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
import { CANCEL_CHANGE_FORM, CANCEL_FORM, CHECKOUT_FORM, changePlanFormId, RESUME_FORM } from './form-ids';

const ACCOUNT_PAGE = '/dashboard/billing';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The organization the form names (M23), or none; never an address taken from the form. */
function organizationOf(form: FormData): string | null {
  const id = textValue(form, 'organizationId', 40);
  return UUID.test(id) ? id.toLowerCase() : null;
}
const pageOf = (organizationId: string | null) => (organizationId ? `/dashboard/organization/${organizationId}/billing` : ACCOUNT_PAGE);
const signInFor = (page: string) => `/sign-in?next=${encodeURIComponent(page)}`;

/** "Choose this plan": starts a test-mode checkout and sends the browser to its page. */
export async function startCheckoutAction(_previous: FormState, form: FormData): Promise<FormState> {
  const planCode = textValue(form, 'planCode', 40) as PlanCode;
  const interval = (textValue(form, 'interval', 8) || 'month') as 'month' | 'year';
  const organizationId = organizationOf(form);
  const page = pageOf(organizationId);
  let url: string;
  try {
    url = (await serverClient(await headers(), await getRequestPrincipal()).billing.checkout({ planCode, interval, ...(organizationId ? { organizationId } : {}) })).url;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(signInFor(page));
    const state = formStateFromFailure(error, { planCode });
    // The organization's page has a form per billing period (forms.tsx, CheckoutForm).
    const formId = organizationId ? `${CHECKOUT_FORM}-${interval === 'year' ? 'year' : 'month'}` : CHECKOUT_FORM;
    return formResult({ form: formId, page, anchor: outcomeTarget(formId, state, false) }, state);
  }
  // The test checkout page of the app, or the provider's own page (Stripe test mode): only an
  // address the procedure gave, which is a path of this app or an https page of the provider.
  const safe = (url.startsWith('/') && !url.startsWith('//')) || url.startsWith('https://checkout.stripe.com/');
  redirect(safe ? url : page);
}

export async function cancelSubscriptionAction(_previous: FormState, form: FormData): Promise<FormState> {
  const page = pageOf(organizationOf(form));
  const state = await change(form, 'cancel', page);
  return formResult({ form: CANCEL_FORM, page, anchor: outcomeTarget(CANCEL_FORM, state, false) }, state);
}

export async function resumeSubscriptionAction(_previous: FormState, form: FormData): Promise<FormState> {
  const page = pageOf(organizationOf(form));
  const state = await change(form, 'resume', page);
  return formResult({ form: RESUME_FORM, page, anchor: outcomeTarget(RESUME_FORM, state, false) }, state);
}

/** M23: "Switch to yearly billing" and the like (billing.changePlan). */
export async function changePlanAction(_previous: FormState, form: FormData): Promise<FormState> {
  const page = pageOf(organizationOf(form));
  const state = await change(form, 'change', page);
  const formId = changePlanFormId(textValue(form, 'planCode', 40), textValue(form, 'interval', 8));
  return formResult({ form: formId, page, anchor: outcomeTarget(formId, state, false) }, state);
}

/** M23: "Keep the current billing" (billing.cancelChange): takes back a change scheduled for the period end. */
export async function cancelChangeAction(_previous: FormState, form: FormData): Promise<FormState> {
  const page = pageOf(organizationOf(form));
  const state = await change(form, 'keep', page);
  return formResult({ form: CANCEL_CHANGE_FORM, page, anchor: outcomeTarget(CANCEL_CHANGE_FORM, state, false) }, state);
}

const INTERVAL_NAME = { month: 'monthly', year: 'yearly' } as const;

async function change(form: FormData, what: 'cancel' | 'resume' | 'change' | 'keep', page: string): Promise<FormState> {
  const subscriptionId = textValue(form, 'subscriptionId', 64);
  try {
    const client = serverClient(await headers(), await getRequestPrincipal());
    if (what === 'change') {
      const planCode = textValue(form, 'planCode', 40) as PlanCode;
      const interval = (textValue(form, 'interval', 8) || 'month') as 'month' | 'year';
      const sub = await client.billing.changePlan({ subscriptionId, planCode, interval });
      refresh();
      return {
        status: 'done',
        message: sub.scheduledChange
          ? `${sub.scheduledChange.planName}, billed ${INTERVAL_NAME[sub.scheduledChange.interval]}, starts on ${formatDay(sub.scheduledChange.startsOn)}. Nothing changes before then.`
          : `${sub.planName} is now billed ${INTERVAL_NAME[sub.interval]}. It renews on ${formatDay(sub.currentPeriodEnd)}.`,
      };
    }
    if (what === 'keep') {
      const sub = await client.billing.cancelChange({ subscriptionId });
      refresh();
      return { status: 'done', message: `${sub.planName} stays billed ${INTERVAL_NAME[sub.interval]}. It renews on ${formatDay(sub.currentPeriodEnd)}.` };
    }
    const sub = what === 'cancel' ? await client.billing.cancel({ subscriptionId }) : await client.billing.resume({ subscriptionId });
    refresh();
    return {
      status: 'done',
      message:
        what === 'cancel'
          ? `${sub.planName} is cancelled at the end of the period. You keep it until ${formatDay(sub.accessUntil ?? sub.currentPeriodEnd)}, and nothing you added is deleted.`
          : `${sub.planName} renews again on ${formatDay(sub.currentPeriodEnd)}.`,
    };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(signInFor(page));
    return formStateFromFailure(error);
  }
}
