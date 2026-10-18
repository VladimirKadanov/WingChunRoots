'use client';

// The two actions of the upgrade prompt (plan §5.6), equally prominent: "Request pilot access"
// (a request to the administrators for a test plan; the pilot takes no payments) and "Not now".
// Both are the same kind of button, the same size, side by side. Once a request is open, its
// state takes the place of the first button. Works without JavaScript: the form posts, and the
// page shows the outcome (src/server/forms/flash.ts).

import Link from 'next/link';
import { useActionState } from 'react';

import { FormMessage, useFocusOnError, useFormId } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import { IDLE, type FormState } from '@/lib/form-state';

const actionClass = cx(buttonVariants({ variant: 'secondary', size: 'lg' }), 'w-full');

export function UpgradeActions({
  action: serverAction,
  planCode,
  planName,
  request,
  notNowHref,
  initial,
}: {
  action: (previous: FormState, form: FormData) => Promise<FormState>;
  planCode: string;
  planName: string;
  /** The account's open pilot access request, if any. */
  request: { planName: string; createdAt: string } | null;
  notNowHref: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(serverAction, initial ?? IDLE);
  const formId = useFormId('pilot-access');
  useFocusOnError(formId, state);
  const sent = state.status === 'done' || request !== null;
  return (
    <div className="grid gap-3">
      <FormMessage form={formId} state={state} single />
      {sent && state.status !== 'done' && request ? (
        <p role="status" className="rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm">
          You asked for pilot access to {request.planName} on {formatDay(request.createdAt)}. An administrator will answer; nothing is
          charged.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {sent ? null : (
          <form id={formId} action={action} aria-busy={pending || undefined}>
            <input type="hidden" name="planCode" value={planCode} />
            <button
              type="submit"
              data-testid="request-pilot-access"
              aria-disabled={pending || undefined}
              onClick={(event) => {
                if (pending) event.preventDefault();
              }}
              className={actionClass}
            >
              {pending ? 'Sending the request…' : 'Request pilot access'}
              <span className="sr-only"> to {planName}</span>
            </button>
          </form>
        )}
        <Link href={notNowHref} scroll={false} data-testid="upgrade-not-now" className={actionClass}>
          Not now
        </Link>
      </div>
    </div>
  );
}
