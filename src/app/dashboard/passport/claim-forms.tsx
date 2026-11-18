'use client';

// The attendance requests of /dashboard/passport (owner decision 2026-11-18, docs/adr/0046-passport-extras.md):
// "Ask the organizer to confirm" a past event the student attended (passport.claimAttendance) and
// "Take back the request" while it waits (passport.withdrawEntry). Thin Server Actions that also
// work without JavaScript; outcomes are words, never colour alone; every target is at least 44 px.

import { useActionState, useId } from 'react';

import { fieldClassName } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { type FormState, IDLE, messageId } from '@/lib/form-state';
import type { ClaimableEvent } from '@/server/services/passport';
import { claimAttendanceAction, withdrawClaimAction } from './actions';
import { PASSPORT_CLAIM_FORM, PASSPORT_CLAIM_WITHDRAW_FORM } from './form-ids';

/** "Which event did you attend?" and the request to its organizer. */
export function ClaimForm({ events, pending, limit, initial }: { events: readonly ClaimableEvent[]; pending: number; limit: number; initial: FormState | null }) {
  const id = useId();
  const [state, action, busy] = useActionState(claimAttendanceAction, initial ?? IDLE);
  const full = pending >= limit;
  const error = state.status === 'error' ? (state.fields?.eventId ?? state.message) : null;
  return (
    <form action={action} noValidate className="grid gap-3" data-testid="passport-claim-form">
      <p className="text-sm text-fg-muted" data-testid="passport-claims-waiting">
        {pending} of {limit} requests waiting for organizers.
      </p>
      {events.length === 0 ? (
        <p className="text-ui text-fg-muted" data-testid="passport-claim-none">
          There is no past event to choose. Events appear here once they have taken place.
        </p>
      ) : (
        <>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-event`} className="text-sm font-semibold">
              Event you attended
            </label>
            <select
              id={`${id}-event`}
              name="eventId"
              required
              defaultValue={state.values?.eventId ?? ''}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? messageId(PASSPORT_CLAIM_FORM) : `${id}-hint`}
              disabled={full}
              className={fieldClassName}
              data-testid="passport-claim-event"
            >
              <option value="" disabled>
                Choose an event
              </option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.dateText} · {e.title} · {e.kindLabel}
                </option>
              ))}
            </select>
            <p id={`${id}-hint`} className="max-w-[60ch] text-sm text-fg-muted">
              {full
                ? 'Wait for an answer, or take a request back, before you ask again.'
                : 'The organizer is asked to confirm it. Until then it shows only here; once confirmed it joins your passport, and you choose whether your profile shows it.'}
            </p>
          </div>
          <div>
            <button
              type="submit"
              aria-disabled={busy || full || undefined}
              onClick={(event) => {
                if (busy || full) event.preventDefault();
              }}
              className={buttonVariants({ variant: 'secondary', size: 'lg' })}
              data-testid="passport-claim-submit"
            >
              {busy ? 'Sending…' : 'Ask the organizer to confirm'}
            </button>
          </div>
        </>
      )}
      {error ? (
        <p id={messageId(PASSPORT_CLAIM_FORM)} role="alert" tabIndex={-1} className="text-ui text-danger" data-testid="passport-claim-error">
          <span className="font-semibold">Not sent:</span> {error}
        </p>
      ) : null}
    </form>
  );
}

/** "Take back the request" of one claim that waits. */
export function WithdrawClaimForm({ id, title, initial }: { id: string; title: string; initial: FormState | null }) {
  const [state, action, busy] = useActionState(withdrawClaimAction, initial ?? IDLE);
  return (
    <form action={action} className="grid gap-1" data-testid="passport-claim-withdraw-form">
      <input type="hidden" name="id" value={id} />
      <div>
        <button
          type="submit"
          aria-disabled={busy || undefined}
          onClick={(event) => {
            if (busy) event.preventDefault();
          }}
          className={buttonVariants({ variant: 'secondary' })}
          data-testid="passport-claim-withdraw"
        >
          {busy ? 'Taking back…' : 'Take back the request'}
          <span className="sr-only"> for “{title}”</span>
        </button>
      </div>
      {state.status === 'error' && state.message ? (
        <p id={messageId(PASSPORT_CLAIM_WITHDRAW_FORM)} role="status" className="text-sm text-danger">
          <span className="font-semibold">Not changed:</span> {state.message}
        </p>
      ) : null}
    </form>
  );
}
