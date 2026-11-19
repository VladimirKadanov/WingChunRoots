'use client';

// "Confirm" and "Refuse" of one attendance request (ADR 0046): one form, two submit buttons, so it
// works without JavaScript. Outcomes are words, never colour alone; every target is at least 44 px.

import { useActionState } from 'react';

import { buttonVariants } from '@/components/ui/button-variants';
import { type FormState, IDLE, messageId } from '@/lib/form-state';
import { decideAttendanceAction } from './actions';
import { ATTENDANCE_DECIDE_FORM } from './form-ids';

export function DecideForm({ id, label, initial }: { id: string; label: string; initial: FormState | null }) {
  const [state, action, busy] = useActionState(decideAttendanceAction, initial ?? IDLE);
  return (
    <form action={action} className="grid gap-1" data-testid="attendance-decide-form">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="decision"
          value="approve"
          aria-disabled={busy || undefined}
          onClick={(event) => {
            if (busy) event.preventDefault();
          }}
          className={buttonVariants({ variant: 'secondary' })}
          data-testid="attendance-confirm"
        >
          Confirm<span className="sr-only"> {label}</span>
        </button>
        <button
          type="submit"
          name="decision"
          value="refuse"
          aria-disabled={busy || undefined}
          onClick={(event) => {
            if (busy) event.preventDefault();
          }}
          className={buttonVariants({ variant: 'ghost' })}
          data-testid="attendance-refuse"
        >
          Refuse<span className="sr-only"> {label}</span>
        </button>
      </div>
      {state.status === 'error' && state.message ? (
        <p id={messageId(ATTENDANCE_DECIDE_FORM)} role="alert" tabIndex={-1} className="text-sm text-danger">
          <span className="font-semibold">Not changed:</span> {state.message}
        </p>
      ) : null}
    </form>
  );
}
