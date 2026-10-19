'use server';

// The dashboard's Server Actions (milestone M08, In scope 4 and 6): thin wrappers over the
// notifications.markRead and plans.requestPilotAccess procedures (src/server/rpc/parity.ts),
// called in-process with this request's session, so the page and /api/v1 run the same checks.

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { PILOT_ACCESS_FORM } from '@/components/plans/form-ids';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import type { PlanCode } from '@/server/entitlements/plans';
import { formResult, postedByReact } from '@/server/forms/flash';
import { formStateFromRpcError, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

const PAGE = '/dashboard';

/**
 * "Mark as read" for one notification (`id`) or all of them (`all=on`). With JavaScript the list
 * marks it at once (useOptimistic) and the page refreshes; without it the browser posts the form
 * and comes back to the list (post/redirect/get).
 */
export async function markReadAction(form: FormData): Promise<void> {
  const id = textValue(form, 'id', 64);
  const input = form.get('all') === 'on' ? { all: true as const } : { ids: [id] };
  try {
    await serverClient(await headers(), await getRequestPrincipal()).notifications.markRead(input);
  } catch (error) {
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fdashboard');
    // A notification that is not the account's own, or an id that is not one: nothing changed.
    if (rpcErrorCode(error) !== 'BAD_REQUEST') throw error;
  }
  if (await postedByReact()) {
    refresh();
    return;
  }
  redirect(`${PAGE}#notifications`);
}

/**
 * "Request pilot access" of the upgrade prompt (plan §5.6): asks the admins for the plan, never
 * charges. The form shows what happened; the page shows the open request from then on.
 */
export async function requestPilotAccessAction(_previous: FormState, form: FormData): Promise<FormState> {
  const state = await requestPilotAccess(form);
  // Without JavaScript the dashboard opens at the prompt's message (PILOT_ACCESS_FORM).
  return formResult({ form: 'pilot-access', page: PAGE, anchor: outcomeTarget(PILOT_ACCESS_FORM, state, true) }, state);
}

async function requestPilotAccess(form: FormData): Promise<FormState> {
  try {
    const outcome = await serverClient(await headers(), await getRequestPrincipal()).plans.requestPilotAccess({
      // The procedure checks the value; this only types what the form sent.
      planCode: textValue(form, 'planCode', 40) as PlanCode,
    });
    refresh();
    return {
      status: 'done',
      message: outcome.created
        ? `Your request for ${outcome.request.planName} was sent to the administrators. Nothing is charged.`
        : `Your request for ${outcome.request.planName} is already with the administrators. Nothing is charged.`,
    };
  } catch (error) {
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fdashboard');
    const state = formStateFromRpcError(error);
    if (state) return state;
    throw error;
  }
}
