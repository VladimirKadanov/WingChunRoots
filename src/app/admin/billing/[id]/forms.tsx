'use client';

// The test clock of /admin/billing/[id] (milestone M22): one button per step the subscription can
// take now (the end of its period; the end of its grace period while a renewal is unpaid). Works
// without JavaScript.

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { IDLE, type FormState } from '@/lib/form-state';
import { moveTestClockAction } from './actions';
import { TEST_CLOCK_FORM } from './form-ids';

export function TestClockForm({ subscriptionId, steps, initial }: { subscriptionId: string; steps: { step: string; label: string }[]; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(moveTestClockAction, initial ?? IDLE);
  useFocusOnError(TEST_CLOCK_FORM, state);
  return (
    <div className="grid gap-3" data-testid="test-clock">
      <FormMessage form={TEST_CLOCK_FORM} state={state} single />
      <div className="flex flex-wrap gap-3">
        {steps.map((s) => (
          <form key={s.step} id={s.step === steps[0]!.step ? TEST_CLOCK_FORM : undefined} action={action} noValidate aria-busy={pending || undefined}>
            <input type="hidden" name="subscriptionId" value={subscriptionId} />
            <input type="hidden" name="step" value={s.step} />
            <SubmitButton pending={pending} pendingLabel="Moving the test clock…" variant="secondary">
              {s.label}
            </SubmitButton>
          </form>
        ))}
      </div>
    </div>
  );
}
