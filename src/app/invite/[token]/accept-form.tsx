'use client';

// "Claim this profile" of /invite/<token> (milestone M10b, In scope 2): an optional note for the
// reviewers and the button, posted to a thin Server Action over invitations.accept with an
// idempotency key the page made for it, so a double press sends one claim.

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { type FormState, IDLE } from '@/lib/form-state';
import { acceptInvitationAction } from './actions';
import { ACCEPT_FORM } from './form-ids';

export function AcceptForm({ token, idempotencyKey, initial }: { token: string; idempotencyKey: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(acceptInvitationAction, initial ?? IDLE);
  const generatedId = useFormId(ACCEPT_FORM);
  const formId = initial ? ACCEPT_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="accept-invitation-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <TextAreaField
        form={formId}
        name="note"
        label="Note for the reviewers"
        optional
        maxLength={2000}
        hint="Who you are and how you know the student, if it helps the reviewers. Never public."
        state={state}
        className="max-w-[40rem]"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Claim this profile
        </SubmitButton>
      </div>
    </form>
  );
}
