'use client';

// The consent-only form of /onboarding (milestone M02, In scope 4): an account that already has
// its profile and has not confirmed a new version of the documents is asked here, and only here,
// before it continues (landingPath in src/server/services/account.ts sends it here after sign-in).

import { useActionState } from 'react';

import { CONSENT_ORDER } from '@/components/account/consents';
import { FormMessage, SubmitButton, firstInvalid, useFocusOnError, useFormId } from '@/components/account/fields';
import { IDLE } from '@/lib/form-state';
import { confirmConsentsAction } from './actions';
import { MissingConsents } from './missing-consents';

const FORM_NAME = 'confirm-consents';

export function ConfirmConsentsForm({
  missingConsents,
  next,
}: {
  /** Required confirmations not given for the current documents. */
  missingConsents: readonly string[];
  next: string;
}) {
  const [state, action, pending] = useActionState(confirmConsentsAction, IDLE);
  const FORM = useFormId(FORM_NAME);
  useFocusOnError(FORM, state);
  const first = firstInvalid(state, CONSENT_ORDER);

  return (
    <form id={FORM} action={action} noValidate className="grid gap-10">
      <input type="hidden" name="next" value={next} />
      <FormMessage form={FORM} state={state} />
      <MissingConsents form={FORM} state={state} missingConsents={missingConsents} first={first} legend="Confirm to continue" />
      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Confirm and continue
        </SubmitButton>
      </div>
    </form>
  );
}
