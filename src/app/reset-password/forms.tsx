'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { DoneNotice, FormMessage, SubmitButton, TextField, useFocusOnError } from '@/components/account/fields';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/account-limits';
import { IDLE } from '@/lib/form-state';
import { requestResetAction, resetPasswordAction } from './actions';

export function RequestResetForm() {
  const [state, action, pending] = useActionState(requestResetAction, IDLE);
  useFocusOnError('request-reset', state);
  if (state.status === 'done') {
    return (
      <DoneNotice form="request-reset" title="Check your inbox">
        <p>
          If <strong className="font-semibold text-fg">{state.values?.email}</strong> belongs to an account, we have sent it a link to
          choose a new password. The link works for one hour and only once.
        </p>
        <p>
          Remembered it? <Link href="/sign-in" className="link">Sign in</Link>.
        </p>
      </DoneNotice>
    );
  }
  return (
    <form id="request-reset" action={action} noValidate className="grid gap-6">
      <FormMessage form="request-reset" state={state} />
      <TextField
        form="request-reset"
        name="email"
        type="email"
        label="E-mail address"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={254}
        state={state}
        autoFocus={state.status === 'error' && Boolean(state.fields?.email)}
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send the reset link
        </SubmitButton>
      </div>
    </form>
  );
}

export function NewPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, IDLE);
  useFocusOnError('new-password', state);
  const expired = state.status === 'error' && !state.fields;
  return (
    <form id="new-password" action={action} noValidate className="grid gap-6">
      <input type="hidden" name="token" value={token} />
      <FormMessage form="new-password" state={state} />
      {expired ? (
        <p className="text-ui">
          <Link href="/reset-password" className="link inline-flex min-h-11 items-center">
            Ask for a new link
          </Link>
        </p>
      ) : (
        <>
          <TextField
            form="new-password"
            name="password"
            type="password"
            label="New password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters. Saving it changes the password and signs you out everywhere.`}
            state={state}
            autoFocus={state.status === 'error' && Boolean(state.fields?.password)}
          />
          <div>
            <SubmitButton pending={pending} pendingLabel="Saving…">
              Save the new password
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
