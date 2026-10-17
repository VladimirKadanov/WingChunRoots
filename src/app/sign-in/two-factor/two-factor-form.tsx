'use client';

import { useActionState } from 'react';

import { FormMessage, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { TOTP_DIGITS } from '@/lib/account-limits';
import { IDLE } from '@/lib/form-state';
import { verifySecondFactorAction } from '../actions';

const FORM_NAME = 'second-factor';

export function TwoFactorForm({ method, next }: { method: 'totp' | 'backup'; next: string }) {
  const [state, action, pending] = useActionState(verifySecondFactorAction, IDLE);
  const FORM = useFormId(FORM_NAME);
  useFocusOnError(FORM, state);
  const totp = method === 'totp';
  return (
    <form id={FORM} action={action} noValidate className="grid gap-6">
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="next" value={state.values?.next ?? next} />
      <FormMessage form={FORM} state={state} />
      {totp ? (
        <TextField
          form={FORM}
          name="code"
          label="6-digit code"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={TOTP_DIGITS + 2}
          spellCheck={false}
          hint="Open your authenticator app and enter the code it shows for WingChunRoots."
          state={state}
          autoFocus
        />
      ) : (
        <TextField
          form={FORM}
          name="code"
          label="Backup code"
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={32}
          hint="One of the codes you saved when you turned on two-factor authentication, for example abcde-12345. Each code works once."
          state={state}
          autoFocus
        />
      )}
      <div>
        <SubmitButton pending={pending} pendingLabel="Checking…">
          Continue
        </SubmitButton>
      </div>
    </form>
  );
}
