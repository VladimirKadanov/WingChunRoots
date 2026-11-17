// "Ask to claim this profile" (ADR 0037): a note for the reviewers (required) and the button,
// posted to a thin Server Action over claims.request with an idempotency key the page made for it,
// so a double press sends one claim.
//
// A Server Component on purpose, as the passport's staff form (../passport-remove-form.tsx): no
// client module for this route (the route budgets, scripts/check-bundle-budget.mjs). The action
// keeps a refusal for the page (keepFormResult), which reads it back as `initial`; the ids follow
// the form kit (src/lib/form-state.ts), so the page opens at the message.

import { AlertIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { fieldId, type FormState, IDLE, messageId, summaryId } from '@/lib/form-state';
import { requestClaimAction } from './actions';
import { CLAIM_FORM } from './form-ids';

const fieldClass = cx(
  'block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-4 py-3 text-field text-fg',
  'hover:border-fg-muted focus-visible:border-fg aria-invalid:border-danger',
);

export function ClaimForm({ personId, slug, idempotencyKey, initial }: { personId: string; slug: string; idempotencyKey: string; initial: FormState | null }) {
  const state = initial ?? IDLE;
  const form = CLAIM_FORM;
  const failed = state.status === 'error';
  const noteError = failed ? state.fields?.note : undefined;
  const otherField = failed ? Object.entries(state.fields ?? {}).find(([name]) => name !== 'note')?.[1] : undefined;
  const noteId = fieldId(form, 'note');
  const hintId = `${noteId}-hint`;
  const errorId = `${noteId}-error`;
  return (
    <form id={form} action={requestClaimAction.bind(null, IDLE)} noValidate className="grid gap-4" data-testid="claim-form">
      <div id={summaryId(form)} tabIndex={-1} className="outline-none">
        {failed && (state.message || otherField) ? (
          <p id={messageId(form)} role="alert" className="flex items-start gap-1.5 font-semibold text-danger" data-testid="claim-refused">
            <AlertIcon size={16} className="mt-1" />
            <span>{otherField ?? state.message}</span>
          </p>
        ) : null}
      </div>
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid gap-1.5">
        <label htmlFor={noteId} className="text-sm font-semibold">
          Note for the reviewers
        </label>
        <p id={hintId} className="max-w-[60ch] text-sm text-fg-muted">
          Who you are, where and with whom you train or teach, and how the reviewers can check it. Never public.
        </p>
        <textarea
          id={noteId}
          name="note"
          rows={5}
          maxLength={2000}
          required
          defaultValue={state.values?.note ?? ''}
          aria-invalid={noteError ? true : undefined}
          aria-describedby={noteError ? `${hintId} ${errorId}` : hintId}
          className={cx(fieldClass, 'max-w-[40rem]')}
        />
        {noteError ? (
          <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger">
            <AlertIcon size={16} className="mt-0.5" />
            <span>{noteError}</span>
          </p>
        ) : null}
      </div>
      <div>
        <button type="submit" className={cx(buttonVariants({ variant: 'primary', size: 'lg' }), 'w-full sm:w-auto sm:min-w-48')}>
          Send the claim
        </button>
      </div>
    </form>
  );
}
