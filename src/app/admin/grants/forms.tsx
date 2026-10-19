'use client';

// The forms of /admin/grants (milestone M08, In scope 3): give a test plan (account, plan, kind,
// reason, start, end), revoke one (with a reason), and close a pilot access request without giving
// the plan (with a reason; review round 2, recheck-5). They post to thin Server Actions over
// grants.create, grants.revoke and grants.closeRequest, and work without JavaScript
// (src/server/forms/flash.ts).

import Link from 'next/link';
import { type ReactNode, useActionState, useState } from 'react';

import { FormMessage, SelectField, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { CheckIcon, ChevronDownIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import { IDLE, type FormState } from '@/lib/form-state';
import { closeRequestAction, createGrantAction, revokeGrantAction } from './actions';
import { closeRequestForm, CREATE_GRANT_FORM, revokeGrantForm } from './form-ids';

const LABELS = {
  email: 'Account e-mail',
  planCode: 'Plan',
  source: 'Kind',
  reason: 'Reason',
  startsOn: 'Starts',
  endsOn: 'Ends',
};

/** What /admin/grants says for `?request=` of a request that is no longer open (final check, screens-4). */
export const REQUEST_ANSWERED_TEXT = 'This pilot access request has already been answered. Nothing is waiting in it.';

/**
 * The "Give a test plan…" disclosure around the form (review round 1, design-6). Open when a pilot
 * request is being answered, and to show the outcome of a post without JavaScript; otherwise closed
 * until the admin opens it. For `?request=` of a request that is no longer open (given or closed,
 * possibly by another admin) it stays closed and says so (final check, screens-4).
 *
 * Both are read once, when the page shows this request (the page keys it by `?request=`): after
 * this admin's own grant the page refreshes, the request is closed and its prefill gone, but the
 * form stays open with its success message, and nothing claims the request was answered before.
 */
export function GivePlanDisclosure({ openAtFirst, answeredAtFirst, children }: { openAtFirst: boolean; answeredAtFirst: boolean; children: ReactNode }) {
  const [{ open, answered }] = useState({ open: openAtFirst, answered: answeredAtFirst });
  return (
    <>
      {answered ? (
        <p data-testid="request-answered" className="flex max-w-[46rem] items-start gap-2 rounded-sm bg-surface-2 px-4 py-3 text-ui">
          <CheckIcon size={18} className="mt-1 shrink-0" />
          <span>{REQUEST_ANSWERED_TEXT}</span>
        </p>
      ) : null}
      <details open={open || undefined} className="group max-w-[46rem]">
        <summary
          data-testid="give-plan-toggle"
          className={cx(buttonVariants({ variant: 'secondary', size: 'lg' }), 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}
        >
          Give a test plan…
          <ChevronDownIcon size={18} className="transition-transform duration-(--duration-fast) group-open:rotate-180" />
        </summary>
        <div className="pt-4">{children}</div>
      </details>
    </>
  );
}

/**
 * Giving a test plan. No plan is chosen in advance (review round 1, a11y-webview-12): the admin
 * picks one, or the pilot request being answered fills it in, and then the reason, the first field
 * left empty, takes the focus (final check, screens-3; with JavaScript, see the reason's field). The date pickers offer today up to
 * the horizon grants.create accepts (two years); the server checks the same bounds.
 */
export function CreateGrantForm({
  plans,
  prefill,
  today,
  horizon,
  initial,
}: {
  plans: readonly { code: string; name: string; audience: string; pilotBenefits: boolean }[];
  prefill: { email: string; planCode: string; requestId: string } | null;
  /** "YYYY-MM-DD" (UTC). */
  today: string;
  /** The last day a grant may start or end on, "YYYY-MM-DD" (UTC). */
  horizon: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(createGrantAction, initial ?? IDLE);
  const generatedId = useFormId('create-grant');
  // The outcome of a post without JavaScript is opened at its message: a fixed id (./form-ids.ts).
  const formId = initial ? CREATE_GRANT_FORM : generatedId;
  useFocusOnError(formId, state);
  const values = state.status === 'done' ? {} : (state.values ?? {});
  const [planCode, setPlanCode] = useState(values.planCode ?? prefill?.planCode ?? '');
  const chosen = plans.find((plan) => plan.code === planCode);
  const [source, setSource] = useState(values.source ?? 'test_grant');
  const requestId = values.requestId ?? prefill?.requestId ?? '';
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5">
      <FormMessage form={formId} state={state} labels={LABELS} />
      {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
      <TextField
        form={formId}
        name="email"
        type="email"
        label={LABELS.email}
        autoComplete="off"
        inputMode="email"
        spellCheck={false}
        autoCapitalize="none"
        translate="no"
        maxLength={320}
        defaultValue={prefill?.email}
        hint="The address the account signs in with."
        state={state}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          form={formId}
          name="planCode"
          label={LABELS.planCode}
          autoComplete="off"
          value={planCode}
          onValue={setPlanCode}
          hint={
            chosen && !chosen.pilotBenefits
              ? `${chosen.name} unlocks nothing yet in the pilot: its features are planned. The account keeps it when they arrive.`
              : 'A Sifu plan works only on a Sifu account, a Student plan only on a Student account.'
          }
          state={state}
        >
          <option value="" disabled>
            Choose a plan
          </option>
          {plans.map((plan) => (
            <option key={plan.code} value={plan.code}>
              {plan.name} ({plan.audience === 'sifu' ? 'Sifu accounts' : 'Student accounts'})
            </option>
          ))}
        </SelectField>
        <SelectField form={formId} name="source" label={LABELS.source} autoComplete="off" value={source} onValue={setSource} state={state}>
          <option value="test_grant">Test plan</option>
          <option value="complimentary">Complimentary</option>
        </SelectField>
      </div>
      <TextField
        form={formId}
        name="reason"
        label={LABELS.reason}
        autoComplete="off"
        maxLength={500}
        // Answering a pilot request (final check, screens-3): the form opens filled in, so the focus
        // goes to the first field left to fill when "Give …" or "Review the request" opens it (a
        // client navigation mounts the field). A page loaded at #give-plan without JavaScript opens
        // at the form instead: the browser skips `autofocus` when the fragment names an element.
        autoFocus={(Boolean(prefill) && !initial) || undefined}
        hint="Kept in the audit log with the grant."
        state={state}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          form={formId}
          name="startsOn"
          type="date"
          label={LABELS.startsOn}
          autoComplete="off"
          defaultValue={today}
          min={today}
          max={horizon}
          hint="From 00:00 UTC that day: today or later."
          state={state}
        />
        <TextField
          form={formId}
          name="endsOn"
          type="date"
          label={LABELS.endsOn}
          optional
          autoComplete="off"
          min={today}
          max={horizon}
          hint="The plan stops at 00:00 UTC that day, so the day before is its last full day. Leave empty for no end date."
          state={state}
        />
      </div>
      <div>
        <SubmitButton pending={pending} pendingLabel="Giving the plan…">
          Give the plan
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Revoking a grant, behind a disclosure in the full-width row under its grant: the reason, then
 * the button. <details> opens without JavaScript and by keyboard. Its summary is a quiet "Revoke…"
 * link; only the button that revokes is in the danger tone (review round 1, design-14). The button
 * names the plan and the account. The row keeps this component once the grant is revoked
 * (`revocable` false), so the outcome stays on screen after the page refreshes; a grant that
 * cannot be revoked renders nothing. A refused revoke (with or without JavaScript) reopens with
 * the focus on the reason (a11y-webview-1).
 */
export function RevokeGrantForm({
  grantId,
  planName,
  email,
  revocable,
  back,
  initial,
}: {
  grantId: string;
  planName: string;
  email: string;
  revocable: boolean;
  /** The list's address (search, sort, page), where a post without JavaScript comes back to. */
  back: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(revokeGrantAction, initial ?? IDLE);
  const generatedId = useFormId('revoke-grant');
  // The outcome of a post without JavaScript is opened at its reason or message (./form-ids.ts).
  const formId = initial ? revokeGrantForm(grantId) : generatedId;
  useFocusOnError(formId, state);
  const failed = state.status === 'error';
  if (state.status === 'done') return <FormMessage form={formId} state={state} single />;
  if (!revocable) return null;
  return (
    <details open={failed || undefined} className="group">
      <summary className="link inline-flex min-h-11 cursor-pointer list-none items-center text-sm [&::-webkit-details-marker]:hidden">
        Revoke…<span className="sr-only"> {planName} of {email}</span>
      </summary>
      <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid max-w-[34rem] gap-3 pt-1 pb-2">
        <FormMessage form={formId} state={state} single />
        <input type="hidden" name="grantId" value={grantId} />
        <input type="hidden" name="back" value={back} />
        <TextField form={formId} name="reason" label="Reason for revoking" autoComplete="off" maxLength={500} autoFocus={failed} state={state} />
        <p className="text-sm text-fg-muted">Confirmed links stay confirmed and public. New approvals above the remaining plan&apos;s limit wait.</p>
        <div>
          <button
            type="submit"
            aria-disabled={pending || undefined}
            onClick={(event) => {
              if (pending) event.preventDefault();
            }}
            className={buttonVariants({ variant: 'danger' })}
          >
            {pending ? 'Revoking…' : `Revoke ${planName}`}
            <span className="sr-only"> of {email}</span>
          </button>
        </div>
      </form>
    </details>
  );
}

/**
 * One open pilot access request (review round 2, recheck-5): the account, the plan and the day, with
 * its two answers: "Give …" opens the grant form filled in, and "Close request…" closes it without
 * a plan, with a reason kept in the audit log. Once closed, the row says so in place of the request
 * (the account was told; the list drops it the next time the page is read). A refused close
 * reopens with the focus on the reason, with or without JavaScript.
 */
export function PilotRequestItem({
  request,
  back,
  initial,
}: {
  request: { id: string; email: string; planName: string; createdAt: string };
  /** The list's address (search, sort, page), where a post without JavaScript comes back to. */
  back: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(closeRequestAction, initial ?? IDLE);
  const generatedId = useFormId('close-request');
  // The outcome of a post without JavaScript is opened at its reason or message (./form-ids.ts).
  const formId = initial ? closeRequestForm(request.id) : generatedId;
  useFocusOnError(formId, state);
  const failed = state.status === 'error';
  if (state.status === 'done') {
    return (
      <li data-testid="pilot-request" data-state="closed" className="border-b border-border-subtle py-3">
        <FormMessage form={formId} state={state} single />
      </li>
    );
  }
  return (
    <li data-testid="pilot-request" data-state="open" className="grid gap-1 border-b border-border-subtle py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-4">
      <span className="grid gap-0.5">
        <span translate="no" className="font-semibold [overflow-wrap:anywhere]">
          {request.email}
        </span>
        <span className="text-sm text-fg-muted">
          {request.planName} · asked on {formatDay(request.createdAt)}
        </span>
      </span>
      <Link href={`/admin/grants?request=${request.id}#give-plan`} className="link inline-flex min-h-11 items-center text-ui">
        Give {request.planName}
        <span className="sr-only"> to {request.email}</span>
      </Link>
      <details open={failed || undefined} className="group sm:col-span-2">
        <summary className="link inline-flex min-h-11 cursor-pointer list-none items-center text-sm [&::-webkit-details-marker]:hidden">
          Close request…<span className="sr-only"> of {request.email}</span>
        </summary>
        <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid max-w-[34rem] gap-3 pt-1 pb-2">
          <FormMessage form={formId} state={state} single />
          <input type="hidden" name="requestId" value={request.id} />
          <input type="hidden" name="back" value={back} />
          <TextField
            form={formId}
            name="reason"
            label="Reason for closing"
            autoComplete="off"
            maxLength={500}
            autoFocus={failed}
            hint="Kept in the audit log; the account is told that the request was closed, not why."
            state={state}
          />
          <div>
            <button
              type="submit"
              aria-disabled={pending || undefined}
              onClick={(event) => {
                if (pending) event.preventDefault();
              }}
              className={buttonVariants({ variant: 'secondary' })}
            >
              {pending ? 'Closing…' : 'Close the request'}
              <span className="sr-only"> of {request.email}</span>
            </button>
          </div>
        </form>
      </details>
    </li>
  );
}
