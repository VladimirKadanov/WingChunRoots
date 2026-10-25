'use client';

// The forms of /account/privacy (milestone M07, In scope 5): withdraw one optional consent, and ask
// for the account to be deleted (with a confirmation box that is never ticked in advance). Both
// work without JavaScript (src/server/forms/flash.ts).
//
// Each form stays on the page after its submit, so its answer stays on screen while the page
// refreshes around it: the withdrawn consent no longer offers its button, and an open deletion
// request is described instead of the form.

import { useActionState } from 'react';

import { CheckboxField, FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import { IDLE, type FormState } from '@/lib/form-state';
import { requestDeletionAction, withdrawConsentAction } from './actions';

export function WithdrawConsentForm({
  kind,
  label,
  available,
  initial,
}: {
  kind: 'publication' | 'privacy_ack';
  label: string;
  /** Whether there is anything to withdraw (the consent is given, or the profile is public). */
  available: boolean;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(withdrawConsentAction, initial ?? IDLE);
  const formId = useFormId(`withdraw-${kind}`);
  useFocusOnError(formId, state);
  if (!available && state.status === 'idle') return null;
  return (
    <form id={formId} action={action} aria-busy={pending || undefined} className="grid justify-items-start gap-3">
      <input type="hidden" name="kind" value={kind} />
      <FormMessage form={formId} state={state} single />
      {available && state.status !== 'done' ? (
        <button
          type="submit"
          aria-disabled={pending || undefined}
          onClick={(event) => {
            if (pending) event.preventDefault();
          }}
          className={cx(buttonVariants({ variant: 'secondary', size: 'sm' }))}
        >
          {pending ? 'Withdrawing…' : label}
        </button>
      ) : null}
    </form>
  );
}

export function DeletionRequestForm({ openRequest, initial }: { openRequest: { openedAt: string } | null; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(requestDeletionAction, initial ?? IDLE);
  const formId = useFormId('deletion');
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4">
      <FormMessage form={formId} state={state} single />
      {openRequest ? (
        <div className="grid gap-2 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-ui">
          <p className="font-semibold">You asked for your account to be deleted on {formatDay(openRequest.openedAt)}.</p>
          <p className="text-sm text-fg-muted">
            The request is open. An administrator carries it out by hand during the pilot; until then you can still sign in and your
            profile stays as it is.
          </p>
        </div>
      ) : state.status === 'done' ? null : (
        <>
          <CheckboxField
            form={formId}
            name="confirm"
            label="I want my account deleted, and I understand that links others have confirmed stay as historical records until the legal review."
            state={state}
            required
          />
          <div>
            <SubmitButton pending={pending} pendingLabel="Sending…" variant="danger">
              Request account deletion
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
