'use client';

// "Claim my record" of /claim/<token> (ADR 0074): an optional note for the reviewers and the
// button, posted to a thin Server Action over claimLinks.accept with an idempotency key the page
// made for it, so a double press sends one claim.

import { useActionState } from 'react';

import { FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { TextAreaField } from '@/components/account/textarea-field';
import { type FormState, IDLE } from '@/lib/form-state';
import { acceptClaimLinkAction } from './actions';
import { ACCEPT_CLAIM_LINK_FORM } from './form-ids';

export function AcceptClaimLinkForm({ token, idempotencyKey, initial }: { token: string; idempotencyKey: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(acceptClaimLinkAction, initial ?? IDLE);
  const generatedId = useFormId(ACCEPT_CLAIM_LINK_FORM);
  const formId = initial ? ACCEPT_CLAIM_LINK_FORM : generatedId;
  useFocusOnError(formId, state);
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-4" data-testid="accept-claim-link-form">
      <FormMessage form={formId} state={state} single />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <TextAreaField
        form={formId}
        name="note"
        label="Note for the reviewers"
        optional
        maxLength={2000}
        hint="Anything that helps the reviewers see that this record is yours, such as where you train. Never public."
        state={state}
        className="max-w-[40rem]"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Claim my record
        </SubmitButton>
      </div>
    </form>
  );
}
