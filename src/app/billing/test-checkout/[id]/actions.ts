'use server';

// The Server Action of the test checkout page (milestone M22): a thin wrapper over billing.testPay
// (src/server/rpc/parity.ts). Only which test card was chosen is sent, never a card number. A paid
// checkout goes back to /dashboard/billing, which reports on it; a declined card stays here.

import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import { formResult } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { TEST_PAY_FORM } from './form-ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function testPayAction(_previous: FormState, form: FormData): Promise<FormState> {
  const checkoutId = textValue(form, 'checkoutId', 64);
  const card = textValue(form, 'card', 32) as 'succeeds' | 'declines' | 'fails_at_renewal';
  const page = UUID.test(checkoutId) ? `/billing/test-checkout/${checkoutId}` : '/dashboard/billing';
  let back = '/dashboard/billing';
  try {
    const paid = await serverClient(await headers(), await getRequestPrincipal()).billing.testPay({ checkoutId, card });
    // M23: an organization's checkout goes back to the organization's billing page.
    if (/^\/dashboard\/(billing|organization\/[0-9a-f-]{36}\/billing)$/.test(paid.backHref)) back = paid.backHref;
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(page)}`);
    const state = formStateFromFailure(error, card ? { card } : undefined);
    return formResult({ form: TEST_PAY_FORM, page, anchor: outcomeTarget(TEST_PAY_FORM, state, false) }, state);
  }
  redirect(`${back}?checkout=${checkoutId}#outcome`);
}
