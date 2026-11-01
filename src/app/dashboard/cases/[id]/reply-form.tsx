'use client';

// The answer to the reviewers on /dashboard/cases/<id> (milestone M10b): a plain form posted to a
// thin Server Action over cases.reply, with an idempotency key the page made for it.

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { type FormState, IDLE } from '@/lib/form-state';
import { replyCaseAction } from './actions';
import { REPLY_FORM } from './form-ids';

export function ReplyForm({ caseId, idempotencyKey, initial }: { caseId: string; idempotencyKey: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(replyCaseAction, initial ?? IDLE);
  const generatedId = useFormId(REPLY_FORM);
  const formId = initial ? REPLY_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-3" data-testid="case-reply-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <TextAreaField form={formId} name="body" label="Your answer" maxLength={2000} hint="The reviewers read it. Never public." state={state} className="max-w-[40rem]" />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…" variant="secondary">
          Send the answer
        </SubmitButton>
      </div>
    </form>
  );
}
