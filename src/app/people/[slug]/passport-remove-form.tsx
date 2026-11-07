// Staff's "Remove a passport entry" (milestone M19, In scope 6): the entry (among those the profile
// shows) and a reason, kept in the audit log and sent to the passport's owner. A thin Server Action
// over passport.remove; the service checks the role and the second factor again.
//
// A Server Component on purpose: a client module here would be in every visitor's JavaScript (only
// staff see the form) and the account form kit (src/components/account/fields.tsx) would push the
// profile over its budget (scripts/check-bundle-budget.mjs). The action keeps a refusal for the page
// (keepFormResult), which reads it back as `initial`; the ids follow the kit (src/lib/form-state.ts),
// so the page opens at the message.

import { AlertIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE, messageId, summaryId } from '@/lib/form-state';
import { PASSPORT_REMOVE_FORM } from './form-ids';
import { removePassportEntryAction } from './passport-actions';

const fieldClass = cx(
  'block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg',
  'hover:border-fg-muted focus-visible:border-fg aria-invalid:border-danger',
);

function Problem({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-danger">
      <AlertIcon size={16} className="mt-0.5" />
      <span>{text}</span>
    </p>
  );
}

export function PassportRemoveForm({ slug, entries, initial }: { slug: string; entries: { value: string; label: string }[]; initial: FormState | null }) {
  const state = initial ?? IDLE;
  const form = PASSPORT_REMOVE_FORM;
  const failed = state.status === 'error';
  const entryError = failed ? (state.fields?.entry ?? state.fields?.id ?? state.fields?.kind) : undefined;
  const reasonError = failed ? state.fields?.reason : undefined;
  const entryId = fieldId(form, 'entry');
  const reasonId = fieldId(form, 'reason');
  return (
    <form id={form} action={removePassportEntryAction.bind(null, IDLE)} noValidate className="grid gap-3" data-testid="passport-remove-form">
      <div id={summaryId(form)} tabIndex={-1} className="outline-none">
        {failed && state.message ? (
          <p id={messageId(form)} role="alert" className="flex items-start gap-1.5 font-semibold text-danger">
            <AlertIcon size={16} className="mt-1" />
            <span>{state.message}</span>
          </p>
        ) : null}
      </div>
      <input type="hidden" name="slug" value={slug} />
      <div className="grid gap-1.5">
        <label htmlFor={entryId} className="text-sm font-semibold">
          Entry
        </label>
        <select
          id={entryId}
          name="entry"
          autoComplete="off"
          defaultValue={state.values?.entry ?? entries[0]?.value ?? ''}
          aria-invalid={entryError ? true : undefined}
          aria-describedby={entryError ? `${entryId}-error` : undefined}
          className={fieldClass}
        >
          {entries.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
        <Problem id={`${entryId}-error`} text={entryError} />
      </div>
      <div className="grid gap-1.5">
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
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? `${reasonId}-hint ${reasonId}-error` : `${reasonId}-hint`}
          className={cx(fieldClass, 'py-3')}
        />
        <Problem id={`${reasonId}-error`} text={reasonError} />
      </div>
      <div>
        <button
          type="submit"
          className={cx(buttonVariants({ variant: 'danger', size: 'lg' }), 'w-full sm:w-auto sm:min-w-48')}
        >
          Remove the entry
        </button>
      </div>
    </form>
  );
}
