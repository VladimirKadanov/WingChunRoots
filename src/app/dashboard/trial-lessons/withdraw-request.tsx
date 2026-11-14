'use client';

// "Withdraw request" on one open trial lesson request (review 2026-11,
// docs/adr/0032-retention-and-withdrawal.md): one button, one form per request with a fixed id, so a
// post without JavaScript comes back to it. A thin Server Action (./actions.ts).

import { useActionState } from 'react';

import { FormMessage, useFocusOnError } from '@/components/account/fields';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { type FormState, IDLE } from '@/lib/form-state';
import { withdrawTrialAction } from './actions';
import { withdrawForm } from './form-ids';

export function WithdrawRequest({ inquiryId, school, initial }: { inquiryId: string; school: string; initial: FormState | null }) {
  const form = withdrawForm(inquiryId);
  const [state, action, pending] = useActionState(withdrawTrialAction, initial ?? IDLE);
  useFocusOnError(form, state);
  return (
    <form id={form} action={action} className="grid justify-items-start gap-2" aria-label={`Withdraw your request to ${school}`} data-testid="trial-withdraw-form">
      <FormMessage form={form} state={state} single />
      <input type="hidden" name="inquiryId" value={inquiryId} />
      <button
        type="submit"
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        className={cx(buttonVariants({ variant: 'secondary' }), 'w-full sm:w-auto')}
        data-testid="trial-withdraw"
      >
        Withdraw request
      </button>
      <p className="text-sm text-fg-muted">Your name, contact and message are removed from it at once. The school is not told.</p>
    </form>
  );
}
