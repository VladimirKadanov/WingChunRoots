'use client';

// The second step of signing in (milestone M02): the code of the authenticator app or a backup
// code, in a field as wide as the code. `initial` is the outcome of a submit without JavaScript.

import { useActionState } from 'react';

import { CodeField, FormMessage, SubmitButton, useFocusOnError, useFormId } from '@/components/account/fields';
import { IDLE, type FormState } from '@/lib/form-state';
import { verifySecondFactorAction } from '../actions';

const FORM_NAME = 'second-factor';

export function TwoFactorForm({ method, next, initial }: { method: 'totp' | 'backup'; next: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(verifySecondFactorAction, initial ?? IDLE);
  const FORM = useFormId(FORM_NAME);
  useFocusOnError(FORM, state);
  const totp = method === 'totp';
  return (
    <form id={FORM} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6">
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="next" value={state.values?.next ?? next} />
      <FormMessage form={FORM} state={state} single />
      <CodeField
        form={FORM}
        kind={method}
        hint={
          totp
            ? 'Open your authenticator app and enter the code it shows for WingChunRoots. If it is about to change, wait for the next one.'
            : 'One of the codes you saved when you turned on two-factor authentication: 8 letters and digits, like XXXX-XXXX. Each code works once.'
        }
        state={state}
        autoFocus
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Checking…">
          Continue
        </SubmitButton>
      </div>
    </form>
  );
}
