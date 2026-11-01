'use client';

// The listing's one-button forms (milestone M11, In scope 2 and 3): "Send for review"
// (schools.submit, which needs Professional Sifu) and "Confirm it is current" (schools.confirm,
// which moves last_activity_at, D17). Thin Server Actions; without JavaScript a failure comes back
// as a kept result (src/server/forms/flash.ts).

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError } from '@/components/account/fields';
import { type FormState, IDLE } from '@/lib/form-state';
import { confirmSchoolAction, submitSchoolAction } from './actions';
import { SCHOOL_ACTION_FORM } from './form-ids';

export function ListingAction({ schoolId, step, label, initial }: { schoolId: string; step: 'submit' | 'confirm'; label: string; initial: FormState | null }) {
  const [state, action, pending] = useActionState(step === 'submit' ? submitSchoolAction : confirmSchoolAction, initial ?? IDLE);
  useFocusOnError(SCHOOL_ACTION_FORM, state);
  return (
    <form id={SCHOOL_ACTION_FORM} action={action} className="grid justify-items-start gap-3" data-testid={`school-${step}`}>
      <FormMessage form={SCHOOL_ACTION_FORM} state={state} single />
      <input type="hidden" name="id" value={schoolId} />
      <SubmitButton pending={pending} pendingLabel={step === 'submit' ? 'Sending…' : 'Confirming…'} variant={step === 'submit' ? 'primary' : 'secondary'}>
        {label}
      </SubmitButton>
    </form>
  );
}
