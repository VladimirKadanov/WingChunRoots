'use client';

// Staff's "Remove a passport entry" (milestone M19, In scope 6): the entry (among those the profile
// shows) and a reason, kept in the audit log and sent to the passport's owner. A thin Server Action
// over passport.remove; the service checks the role and the second factor again.

import { useActionState } from 'react';

import { describedBy, fieldClassName, FieldError, FormMessage, SelectField, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { PASSPORT_REMOVE_FORM } from './form-ids';
import { removePassportEntryAction } from './passport-actions';

export function PassportRemoveForm({ slug, entries, initial }: { slug: string; entries: { value: string; label: string }[]; initial: FormState | null }) {
  const [state, action, pending] = useActionState(removePassportEntryAction, initial ?? IDLE);
  const form = PASSPORT_REMOVE_FORM;
  useFocusOnError(form, state);
  const error = state.status === 'error' ? state.fields?.reason : undefined;
  const reasonId = fieldId(form, 'reason');
  return (
    <form id={form} action={action} noValidate className="grid gap-3" data-testid="passport-remove-form">
      <FormMessage form={form} state={state} labels={{ entry: 'Entry', reason: 'Reason', id: 'Entry' }} />
      <input type="hidden" name="slug" value={slug} />
      <SelectField form={form} name="entry" label="Entry" state={state} autoComplete="off" defaultValue={state.values?.entry ?? entries[0]?.value ?? ''}>
        {entries.map((e) => (
          <option key={e.value} value={e.value}>
            {e.label}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-1.5" data-field="">
        <label htmlFor={reasonId} className="text-sm font-semibold">
          Reason
        </label>
        <p id={`${reasonId}-hint`} className="text-sm text-fg-muted">
          Kept in the audit log and sent to the passport’s owner. The entry is then shown to nobody; it is kept.
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
          Remove the entry
        </SubmitButton>
      </div>
    </form>
  );
}
