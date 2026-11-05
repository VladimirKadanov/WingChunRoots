'use server';

// The dashboard's Server Actions (milestone M08, In scope 4 and 6): thin wrappers over the
// notifications.markRead (M18: and notifications.markAllRead) and plans.requestPilotAccess procedures (src/server/rpc/parity.ts),
// called in-process with this request's session, so the page and /api/v1 run the same checks.
// A failure never escapes as it is (review round 2, recheck-2; see src/app/admin/grants/actions.ts).

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';

import { PILOT_ACCESS_FORM } from '@/components/plans/form-ids';
import { textValue } from '@/lib/form-data';
import { type FormState, outcomeTarget } from '@/lib/form-state';
import { getRequestPrincipal } from '@/server/auth/web';
import type { PlanCode } from '@/server/entitlements/plans';
import type { NotificationCategory } from '@/server/templates/catalog';
import { formResult, postedByReact } from '@/server/forms/flash';
import { formStateFromFailure, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

const PAGE = '/dashboard';

/**
 * "Mark as read" for one notification (`id`) or all of them (`all=on`). With JavaScript the list
 * marks it at once (useOptimistic) and the page refreshes; without it the browser posts the form
 * and comes back to the list (post/redirect/get).
 */
export async function markReadAction(form: FormData): Promise<void> {
  const id = textValue(form, 'id', 64);
  const all = form.get('all') === 'on';
  // M18: the page the form was on (/dashboard/notifications, a page and a category), and "Mark all as
  // read" of that category only (notifications.markAllRead).
  const back = backTo(textValue(form, 'back', 200));
  const category = textValue(form, 'category', 40);
  const byReact = await postedByReact();
  try {
    const client = serverClient(await headers(), await getRequestPrincipal());
    // The procedure checks the category; this only types what the form sent.
    if (all) await client.notifications.markAllRead(category ? { category: category as NotificationCategory } : {});
    else await client.notifications.markRead({ ids: [id] });
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect(`/sign-in?next=${encodeURIComponent(back ?? PAGE)}`);
    // A notification that is not the account's own, or an id that is not one: nothing changed.
    // Anything else changed nothing either (one transaction) and was logged by serverClient() in a
    // safe line; it is never rethrown as it is (review round 2, recheck-2). With JavaScript the list
    // needs to hear of it, to say so and put the item back: a bare error without the cause. Without
    // JavaScript the list comes back with the item still new.
    if (rpcErrorCode(error) !== 'BAD_REQUEST' && byReact) throw new Error('Marking notifications read failed.');
  }
  if (byReact) {
    refresh();
    return;
  }
  redirect(`${back ?? PAGE}#notifications`);
}

/** The notifications page a form came from, or null for the dashboard (never another path). */
function backTo(value: string): string | null {
  if (!value) return null;
  const url = new URL(value, 'http://local.invalid');
  return url.origin === 'http://local.invalid' && url.pathname === '/dashboard/notifications' ? `${url.pathname}${url.search}` : null;
}

/** What follows a pilot access request (review round 2; final check, requirements-5). */
const PILOT_NEXT = 'An administrator either gives you the plan or closes the request, and you get a notification either way.';

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
      // What happens next, right away (final check, requirements-5), as the prompt says on a later visit.
      message: outcome.created
        ? `Your request for ${outcome.request.planName} was sent to the administrators. ${PILOT_NEXT} Nothing is charged.`
        : `Your request for ${outcome.request.planName} is already with the administrators. ${PILOT_NEXT} Nothing is charged.`,
    };
  } catch (error) {
    unstable_rethrow(error);
    if (rpcErrorCode(error) === 'UNAUTHORIZED') redirect('/sign-in?next=%2Fdashboard');
    const state = formStateFromFailure(error);
    // The plan is a hidden field: a field error (a plan of the other account type, after the account
    // switched in another tab or app) is said as the form's message, which takes the focus, with
    // and without JavaScript (review round 2, recheck-4).
    const fields = Object.values(state.fields ?? {});
    return fields[0] ? { status: 'error', message: fields[0] } : state;
  }
}
