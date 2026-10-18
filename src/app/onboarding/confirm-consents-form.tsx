'use client';

// The consent-only form of /onboarding (milestone M02, In scope 4): an account that already has
// its profile and has not confirmed a new version of the documents is asked here, and only here,
// before it continues (landingPath in src/server/services/account.ts sends it here after sign-in).
// `initial` is the outcome of a submit without JavaScript (src/server/forms/flash.ts).

import { useActionState } from 'react';

import { CONSENT_ORDER } from '@/components/account/consents';
import { FormMessage, SubmitButton, firstInvalid, useFocusOnError, useFormId } from '@/components/account/fields';
import { IDLE, type FormState } from '@/lib/form-state';
import { confirmConsentsAction } from './actions';
import { type DocumentNote, MissingConsents } from './missing-consents';

const FORM_NAME = 'confirm-consents';
const LABELS = { age_18_plus: 'Age', terms: 'Terms of use', authenticity_declaration: 'What you record' };

export function ConfirmConsentsForm({
  missingConsents,
  documents,
  next,
  initial,
}: {
  /** Required confirmations not given for the current documents. */
  missingConsents: readonly string[];
  documents: readonly DocumentNote[];
  next: string;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(confirmConsentsAction, initial ?? IDLE);
  const FORM = useFormId(FORM_NAME);
  useFocusOnError(FORM, state);
  const first = firstInvalid(state, CONSENT_ORDER);

  return (
    <form id={FORM} action={action} noValidate aria-busy={pending || undefined} className="grid gap-8">
      <input type="hidden" name="next" value={next} />
      <FormMessage form={FORM} state={state} labels={LABELS} />
      <MissingConsents
        form={FORM}
        state={state}
        missingConsents={missingConsents}
        documents={documents}
        first={first}
        legend="Confirm to continue"
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Confirm and continue
        </SubmitButton>
      </div>
    </form>
  );
}
