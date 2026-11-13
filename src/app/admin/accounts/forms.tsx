'use client';

// The forms of /admin/accounts (review 2026-11; docs/adr/0030-takedown-suspension-erasure.md):
// suspend an account (its address, a reason, an optional last day), lift a suspension (a reason), and
// erase an account (a reason and a confirmation). Each posts to a thin Server Action over one
// procedure (./actions.ts) and works without JavaScript (src/server/forms/flash.ts).

import { useActionState } from 'react';

import { CheckboxField, FormMessage, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { type FormState, IDLE } from '@/lib/form-state';
import { eraseAction, suspendAction, unsuspendAction } from './actions';
import { ERASE_FORM, SUSPEND_FORM, unsuspendForm } from './form-ids';

const SUSPEND_LABELS = { email: 'Account e-mail', reason: 'Reason', until: 'Ends' };
const ERASE_LABELS = { email: 'Account e-mail', reason: 'Reason', confirm: 'Confirmation' };

/** Suspending an account: the person is signed out at once and cannot sign in until it is lifted. */
export function SuspendForm({ today, initial }: { today: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(suspendAction, initial ?? IDLE);
  const generatedId = useFormId('suspend-account');
  // The outcome of a post without JavaScript is opened at its message: a fixed id (./form-ids.ts).
  const formId = initial ? SUSPEND_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid max-w-[34rem] gap-5" data-testid="suspend-form">
      <FormMessage form={formId} state={state} labels={SUSPEND_LABELS} />
      <TextField
        form={formId}
        name="email"
        type="email"
        label={SUSPEND_LABELS.email}
        autoComplete="off"
        inputMode="email"
        spellCheck={false}
        autoCapitalize="none"
        translate="no"
        maxLength={320}
        hint="The address the account signs in with."
        state={state}
      />
      <TextAreaField
        form={formId}
        name="reason"
        label={SUSPEND_LABELS.reason}
        maxLength={500}
        hint="Required. Kept in the audit log. The person is not sent this or any message: tell them by other means, if at all."
        state={state}
      />
      <TextField
        form={formId}
        name="until"
        type="date"
        label={SUSPEND_LABELS.until}
        optional
        autoComplete="off"
        min={today}
        hint="The suspension ends by itself at 00:00 UTC that day. Leave empty to keep it until you lift it."
        state={state}
      />
      <p className="text-sm text-fg-muted">
        The account is signed out everywhere at once and refused on every page and sign-in. Its profile stays as it is: take a profile
        down from its record page. You can not suspend your own account or the last active administrator.
      </p>
      <div>
        <SubmitButton pending={pending} pendingLabel="Suspending…" variant="danger">
          Suspend account
        </SubmitButton>
      </div>
    </form>
  );
}

/** One suspended account, with "Lift suspension…" (a reason) behind a disclosure. */
export function SuspendedItem({
  account,
  initial,
}: {
  account: { id: string; email: string; reason: string | null; until: string | null; since: string };
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(unsuspendAction, initial ?? IDLE);
  const generatedId = useFormId('unsuspend-account');
  const formId = initial ? unsuspendForm(account.id) : generatedId;
  useFocusOnError(formId, state);
  const failed = state.status === 'error';
  if (state.status === 'done') {
    return (
      <li data-testid="suspended-account" data-state="lifted" className="border-b border-border-subtle py-3">
        <FormMessage form={formId} state={state} single />
      </li>
    );
  }
  return (
    <li data-testid="suspended-account" data-state="suspended" className="grid gap-1 border-b border-border-subtle py-3">
      <span translate="no" className="font-semibold [overflow-wrap:anywhere]">
        {account.email}
      </span>
      <span className="text-sm text-fg-muted">
        Suspended on {formatDay(account.since)} · {account.until ? `ends ${formatDay(account.until)}` : 'until an administrator lifts it'}
      </span>
      {account.reason ? <span className="max-w-[60ch] text-ui [overflow-wrap:anywhere]">{account.reason}</span> : null}
      <details open={failed || undefined} className="group">
        <summary className="link inline-flex min-h-11 cursor-pointer list-none items-center text-sm [&::-webkit-details-marker]:hidden">
          Lift suspension…<span className="sr-only"> of {account.email}</span>
        </summary>
        <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid max-w-[34rem] gap-3 pt-1 pb-2">
          <FormMessage form={formId} state={state} single />
          <input type="hidden" name="userId" value={account.id} />
          <TextAreaField form={formId} name="reason" label="Reason for lifting the suspension" maxLength={500} hint="Required. Kept in the audit log." state={state} />
          <div>
            <button
              type="submit"
              aria-disabled={pending || undefined}
              onClick={(event) => {
                if (pending) event.preventDefault();
              }}
              className={buttonVariants({ variant: 'secondary' })}
            >
              {pending ? 'Lifting…' : 'Lift suspension'}
              <span className="sr-only"> of {account.email}</span>
            </button>
          </div>
        </form>
      </details>
    </li>
  );
}

/**
 * Erasing an account, for good. From a deletion request (`request`) the account is the one that
 * asked and the request is closed with it; otherwise the administrator gives the address.
 */
export function EraseForm({ request, initial }: { request: { caseId: string; email: string | null } | null; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(eraseAction, initial ?? IDLE);
  const generatedId = useFormId('erase-account');
  const formId = initial ? ERASE_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid max-w-[34rem] gap-5" data-testid="erase-form">
      <FormMessage form={formId} state={state} labels={ERASE_LABELS} />
      {request ? (
        <>
          <input type="hidden" name="caseId" value={request.caseId} />
          <p className="text-ui">
            The account that asked for its deletion:{' '}
            <span translate="no" className="font-semibold [overflow-wrap:anywhere]">
              {request.email ?? 'its account is gone already'}
            </span>
            . The request is closed with the erasure.
          </p>
        </>
      ) : (
        <TextField
          form={formId}
          name="email"
          type="email"
          label={ERASE_LABELS.email}
          autoComplete="off"
          inputMode="email"
          spellCheck={false}
          autoCapitalize="none"
          translate="no"
          maxLength={320}
          hint="The address the account signs in with. A member who asked in the app is on the administration page, under Account deletion requests."
          state={state}
        />
      )}
      <TextAreaField
        form={formId}
        name="reason"
        label={ERASE_LABELS.reason}
        maxLength={500}
        hint="Required. Kept in the audit log, never shown to the person."
        state={state}
      />
      <CheckboxField
        form={formId}
        name="confirm"
        label="I understand that this can not be undone"
        hint="The sign-in account, the profile's other names and biography, photos, schools, events, the passport and pending requests are removed. Relationships that others confirmed stay as historical records."
        state={state}
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Erasing…" variant="danger">
          Erase account
        </SubmitButton>
      </div>
    </form>
  );
}
