'use client';

// Staff's "Remove the event" (milestone M17, In scope 3): a reason, kept in the audit log and never
// shown; the event is then 404 everywhere. A thin Server Action over events.remove; the service
// checks the role and the second factor again.

import { useActionState } from 'react';

import { describedBy, fieldClassName, FieldError, FormMessage, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { removeEventAction } from './actions';
import { EVENT_REMOVE_FORM } from './form-ids';

export function RemoveEventForm({ id, slug, initial }: { id: string; slug: string; initial: FormState | null }) {
  const [state, action, pending] = useActionState(removeEventAction, initial ?? IDLE);
  const form = EVENT_REMOVE_FORM;
  useFocusOnError(form, state);
  const error = state.status === 'error' ? state.fields?.reason : undefined;
  const reasonId = fieldId(form, 'reason');
  return (
    <form id={form} action={action} noValidate className="grid gap-3" data-testid="event-remove-form">
      <FormMessage form={form} state={state} labels={{ reason: 'Reason' }} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="slug" value={slug} />
      <div className="grid gap-1.5" data-field="">
        <label htmlFor={reasonId} className="text-sm font-semibold">
          Reason
        </label>
        <p id={`${reasonId}-hint`} className="text-sm text-fg-muted">
          Kept in the audit log; the organizer and the public never see it. The event is then gone from every page.
        </p>
        <textarea
          id={reasonId}
          name="reason"
          rows={3}
          maxLength={1000}
          required
          defaultValue={state.values?.reason ?? ''}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(`${reasonId}-hint`, error && `${reasonId}-error`)}
          className={cx(fieldClassName, 'py-3')}
        />
        <FieldError id={`${reasonId}-error`} error={error} />
      </div>
      <div>
        <SubmitButton pending={pending} pendingLabel="Removing…" variant="danger">
          Remove the event
        </SubmitButton>
      </div>
    </form>
  );
}
