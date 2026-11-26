'use client';

// "Your rank ladder" (role replay 2026-11-25, P2-8, ADR 0072): the ranks of the school, one per
// line, in order. Set once, offered as the pick list wherever this account records a rank.

import Link from 'next/link';
import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { type FormState, IDLE } from '@/lib/form-state';
import { LADDER_FORM } from '../form-ids';
import { setLadderAction } from './actions';

export function LadderForm({ steps, initial }: { steps: readonly string[]; initial: FormState | null }) {
  const [state, action, pending] = useActionState(setLadderAction, initial ?? IDLE);
  useFocusOnError(LADDER_FORM, state);
  return (
    <form id={LADDER_FORM} action={action} noValidate className="grid gap-4" data-testid="passport-ladder-form">
      <FormMessage form={LADDER_FORM} state={state} labels={{ steps: 'Your ranks' }} single />
      <TextAreaField
        form={LADDER_FORM}
        name="steps"
        label="Your ranks, one per line"
        state={state}
        optional
        rows={10}
        maxLength={4000}
        defaultValue={steps.join('\n')}
        hint="From the first rank to the highest, such as “First level”, “Second level”. At most 30. Leave it empty to remove the ladder."
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save the ladder
        </SubmitButton>
        <Link href="/dashboard/students" className="link inline-flex min-h-11 items-center">
          Cancel
        </Link>
      </div>
    </form>
  );
}
