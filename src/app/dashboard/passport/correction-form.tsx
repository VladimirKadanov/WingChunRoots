'use client';

// "Propose a correction" (milestone M19, In scope 2): a student never changes an entry their teacher
// or organization recorded; they say what is wrong, and whoever recorded it is told (a notice) and
// changes it or not. A thin Server Action over passport.updateEntry with `correction` only.

import Link from 'next/link';
import { useActionState } from 'react';

import { describedBy, fieldClassName, FieldError, FormMessage, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE } from '@/lib/form-state';
import { proposeCorrectionAction } from './actions';
import { PASSPORT_CORRECTION_FORM } from './form-ids';

export function CorrectionForm({ kind, id, initial }: { kind: string; id: string; initial: FormState | null }) {
  const [state, action, pending] = useActionState(proposeCorrectionAction, initial ?? IDLE);
  const form = PASSPORT_CORRECTION_FORM;
  useFocusOnError(form, state);
  const error = state.status === 'error' ? state.fields?.correction : undefined;
  const noteId = fieldId(form, 'correction');
  return (
    <form id={form} action={action} noValidate className="grid gap-3 rounded-sm border border-border-strong p-4" data-testid="passport-correction-form">
      <FormMessage form={form} state={state} labels={{ correction: 'What should change' }} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-1.5" data-field="">
        <label htmlFor={noteId} className="text-sm font-semibold">
          What should change
        </label>
        <p id={`${noteId}-hint`} className="text-sm text-fg-muted">
          Sent to whoever recorded the entry. They change it, or not; the entry stays as it is until then.
        </p>
        <textarea
          id={noteId}
          name="correction"
          rows={3}
          maxLength={1000}
          required
          autoFocus
          defaultValue={state.values?.correction ?? ''}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(`${noteId}-hint`, error && `${noteId}-error`)}
          className={cx(fieldClassName, 'py-3')}
        />
        <FieldError id={`${noteId}-error`} error={error} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending} pendingLabel="Sending…" variant="secondary">
          Send the correction
        </SubmitButton>
        <Link href={`/dashboard/passport#entry-${id}`} className="link inline-flex min-h-11 items-center">
          Cancel
        </Link>
      </div>
    </form>
  );
}
