'use client';

// "Cancel the event" (milestone M17, In scope 3): the event stays in the calendar marked Cancelled,
// with the optional note; Premium Students of its teachers get a notice (DEFAULT M17, question 3).
// A thin Server Action over events.cancel.

import { useActionState } from 'react';

import { describedBy, fieldClassName, FieldError, FormMessage, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { cancelEventAction } from './actions';
import { EVENT_CANCEL_FORM } from './form-ids';

export function CancelEventForm({ id, initial }: { id: string; initial: FormState | null }) {
  const [state, action, pending] = useActionState(cancelEventAction, initial ?? IDLE);
  const form = EVENT_CANCEL_FORM;
  useFocusOnError(form, state);
  const error = state.status === 'error' ? state.fields?.note : undefined;
  const noteId = fieldId(form, 'note');
  return (
    <form id={form} action={action} noValidate className="grid gap-3" data-testid="event-cancel-form">
      <FormMessage form={form} state={state} labels={{ note: 'Note' }} />
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-1.5" data-field="">
        <label htmlFor={noteId} className="text-sm font-semibold">
          Note <span className="font-normal text-fg-muted">(optional, public)</span>
        </label>
        <p id={`${noteId}-hint`} className="text-sm text-fg-muted">
          Shown on the event’s page, such as “Moved to the spring”. The event stays in the calendar, marked Cancelled; it cannot be changed after.
        </p>
        <textarea
          id={noteId}
          name="note"
          rows={3}
          maxLength={1000}
          defaultValue={state.values?.note ?? ''}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(`${noteId}-hint`, error && `${noteId}-error`)}
          className={cx(fieldClassName, 'py-3')}
        />
        <FieldError id={`${noteId}-error`} error={error} />
      </div>
      <div>
        <SubmitButton pending={pending} pendingLabel="Cancelling…" variant="danger">
          Cancel the event
        </SubmitButton>
      </div>
    </form>
  );
}
