'use client';

// The appeal of a decision on /dashboard/cases/<id> (milestone M25, In scope 2): why the decision
// should be looked at again, posted to a thin Server Action over appeals.create with an idempotency
// key the page made for it. One appeal per decision.

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { type FormState, IDLE } from '@/lib/form-state';
import { appealDecisionAction } from './actions';
import { APPEAL_FORM } from './form-ids';

export function AppealForm({ caseId, idempotencyKey, initial }: { caseId: string; idempotencyKey: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(appealDecisionAction, initial ?? IDLE);
  const generatedId = useFormId(APPEAL_FORM);
  const formId = initial ? APPEAL_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3" data-testid="case-appeal-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <TextAreaField
        form={formId}
        name="grounds"
        label="Why the decision should be looked at again"
        maxLength={2000}
        hint="Staff read it. Never public."
        state={state}
        className="max-w-[40rem]"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…" variant="secondary">
          Send the appeal
        </SubmitButton>
      </div>
    </form>
  );
}
