'use client';

// The small forms of the teacher-request pages (milestone M09, In scope 3, 6 and 7): Approve and
// Decline on the teacher's side, Withdraw on the student's, and "Mark training as ended" on both.
// Each is one Server Action (the page passes it in) over one procedure; each carries an
// idempotency key the page made for it, so a second press, a retried post or a reload of the post
// changes nothing (plan §5.6). The button is aria-disabled while the action runs: a double click
// sends one request. Work without JavaScript: the browser posts the form, the action answers
// post/redirect/get, and a refusal comes back opened at the row's message (src/server/forms/flash.ts).

import { useActionState, useState } from 'react';

import { FormMessage, SelectField, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { IDLE, type FormState } from '@/lib/form-state';

type Action = (previous: FormState, form: FormData) => Promise<FormState>;

function RowButton({ pending, label, pendingLabel, who, variant = 'secondary' }: { pending: boolean; label: string; pendingLabel: string; who: string; variant?: 'secondary' | 'ink' | 'danger' }) {
  return (
    <button
      type="submit"
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className={cx(buttonVariants({ variant }), 'w-full sm:w-auto')}
    >
      {pending ? pendingLabel : label}
      <span className="sr-only"> ({who})</span>
    </button>
  );
}

/**
 * "Approve" of a waiting request. A refusal (the plan's limit, a cycle, a request answered in
 * another tab) shows as the row's message; at the limit it points to the upgrade prompt above.
 */
export function ApproveForm({
  action,
  relationshipId,
  idempotencyKey,
  who,
  fixedId,
  initial,
}: {
  action: Action;
  relationshipId: string;
  idempotencyKey: string;
  /** The student's name, for the button's accessible name. */
  who: string;
  /** The row's fixed form id, for the outcome of a post without JavaScript. */
  fixedId: string;
  initial?: FormState | null;
}) {
  const [state, formAction, pending] = useActionState(action, initial ?? IDLE);
  const generatedId = useFormId('approve');
  const formId = initial ? fixedId : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={formAction} noValidate aria-busy={pending || undefined} className="grid gap-2" data-testid="approve-form">
      <FormMessage form={formId} state={state} single />
      {state.status === 'error' && state.values?.limit === 'reached' ? (
        <p className="text-sm">
          <a href="#upgrade" className="link inline-flex min-h-11 items-center">
            See what a higher plan adds
          </a>
        </p>
      ) : null}
      <input type="hidden" name="relationshipId" value={relationshipId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div>
        <RowButton pending={pending} label="Approve" pendingLabel="Approving…" who={who} variant="ink" />
      </div>
    </form>
  );
}

/** "Decline…" of a waiting request: a neutral reason from the list, never free text (plan §5.6). */
export function DeclineForm({
  action,
  relationshipId,
  idempotencyKey,
  who,
  reasons,
  fixedId,
  initial,
}: {
  action: Action;
  relationshipId: string;
  idempotencyKey: string;
  who: string;
  reasons: readonly { value: string; label: string }[];
  fixedId: string;
  initial?: FormState | null;
}) {
  const [state, formAction, pending] = useActionState(action, initial ?? IDLE);
  const generatedId = useFormId('decline');
  const formId = initial ? fixedId : generatedId;
  useFocusOnError(formId, state);
  const failed = state.status === 'error';
  // Controlled: React resets the form after its action, which would drop the choice (finding H2).
  const [reason, setReason] = useState(initial?.values?.reason ?? '');
  return (
    <details open={failed || undefined} className="group">
      <summary className="link inline-flex min-h-11 cursor-pointer list-none items-center text-sm [&::-webkit-details-marker]:hidden">
        Decline…<span className="sr-only"> ({who})</span>
      </summary>
      <form id={formId} action={formAction} noValidate aria-busy={pending || undefined} className="grid max-w-[30rem] gap-3 pt-1 pb-2" data-testid="decline-form">
        <FormMessage form={formId} state={state} single />
        <input type="hidden" name="relationshipId" value={relationshipId} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <SelectField
          form={formId}
          name="reason"
          label="Reason"
          autoComplete="off"
          value={reason}
          onValue={setReason}
          autoFocus={failed && Boolean(state.fields?.reason)}
          hint="The student sees this reason and can correct the request and send it again."
          state={state}
        >
          <option value="" disabled>
            Choose a reason
          </option>
          {reasons.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </SelectField>
        <div>
          <RowButton pending={pending} label="Decline the request" pendingLabel="Declining…" who={who} />
        </div>
      </form>
    </details>
  );
}

/** "Withdraw" of the student's own request, waiting or declined. */
export function WithdrawForm({
  action,
  relationshipId,
  idempotencyKey,
  who,
  fixedId,
  initial,
}: {
  action: Action;
  relationshipId: string;
  idempotencyKey: string;
  /** The teacher's name, for the button's accessible name. */
  who: string;
  fixedId: string;
  initial?: FormState | null;
}) {
  const [state, formAction, pending] = useActionState(action, initial ?? IDLE);
  const generatedId = useFormId('withdraw');
  const formId = initial ? fixedId : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={formAction} noValidate aria-busy={pending || undefined} className="grid gap-2">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="relationshipId" value={relationshipId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div>
        <RowButton pending={pending} label="Withdraw request" pendingLabel="Withdrawing…" who={who} variant="danger" />
      </div>
    </form>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * "Mark training as ended…" of a confirmed link: the year (and the month, if known) the training
 * ended. The link stays, as historical; nothing is deleted.
 */
export function EndTrainingForm({
  action,
  relationshipId,
  idempotencyKey,
  who,
  page,
  fixedId,
  initial,
}: {
  action: Action;
  relationshipId: string;
  idempotencyKey: string;
  /** The other person's name, for the accessible names. */
  who: string;
  /** Which page posts it: the action comes back there. */
  page: 'teachers' | 'students';
  fixedId: string;
  initial?: FormState | null;
}) {
  const [state, formAction, pending] = useActionState(action, initial ?? IDLE);
  const generatedId = useFormId('end-training');
  const formId = initial ? fixedId : generatedId;
  useFocusOnError(formId, state);
  const failed = state.status === 'error';
  const [month, setMonth] = useState(initial?.values?.endMonth ?? '');
  return (
    <details open={failed || undefined} className="group">
      <summary className="link inline-flex min-h-11 cursor-pointer list-none items-center text-sm [&::-webkit-details-marker]:hidden">
        Mark training as ended…<span className="sr-only"> ({who})</span>
      </summary>
      <form id={formId} action={formAction} noValidate aria-busy={pending || undefined} className="grid max-w-[30rem] gap-3 pt-1 pb-2" data-testid="end-training-form">
        <FormMessage form={formId} state={state} single />
        <input type="hidden" name="relationshipId" value={relationshipId} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="page" value={page} />
        <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-3">
          <TextField
            form={formId}
            name="endYear"
            label="Year ended"
            autoComplete="off"
            inputMode="numeric"
            maxLength={4}
            autoFocus={failed && Boolean(state.fields?.endYear)}
            state={state}
          />
          <SelectField form={formId} name="endMonth" label="Month" optional autoComplete="off" value={month} onValue={setMonth} state={state}>
            <option value="">Not sure</option>
            {MONTHS.map((month, index) => (
              <option key={month} value={String(index + 1)}>
                {month}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="text-sm text-fg-muted">The link stays on both profiles, shown as historical. Nothing is deleted.</p>
        <div>
          <RowButton pending={pending} label="Mark as ended" pendingLabel="Saving…" who={who} />
        </div>
      </form>
    </details>
  );
}
