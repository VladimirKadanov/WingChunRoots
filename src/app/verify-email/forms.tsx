'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { DoneNotice, FormMessage, SubmitButton, TextField, useFocusOnError } from '@/components/account/fields';
import { IDLE } from '@/lib/form-state';
import { confirmEmailAction, resendConfirmationAction } from './actions';

export function ConfirmEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmEmailAction, IDLE);
  useFocusOnError('confirm-email', state);
  return (
    <form id="confirm-email" action={action} className="grid gap-6">
      <input type="hidden" name="token" value={token} />
      <FormMessage form="confirm-email" state={state} />
      {state.status === 'error' ? null : (
        <div>
          <SubmitButton pending={pending} pendingLabel="Confirming…">
            Confirm my address
          </SubmitButton>
        </div>
      )}
    </form>
  );
}

export function ResendConfirmationForm({ title = 'Send the link again' }: { title?: string }) {
  const [state, action, pending] = useActionState(resendConfirmationAction, IDLE);
  useFocusOnError('resend-confirmation', state);
  if (state.status === 'done') {
    return (
      <DoneNotice form="resend-confirmation" title="Check your inbox">
        <p>
          If <strong className="font-semibold text-fg">{state.values?.email}</strong> belongs to an account that waits for confirmation,
          we have sent it a new link. It works for 24 hours.
        </p>
        <p>
          Already confirmed? <Link href="/sign-in" className="link">Sign in</Link>.
        </p>
      </DoneNotice>
    );
  }
  return (
    <form id="resend-confirmation" action={action} noValidate aria-labelledby="resend-confirmation-title" className="grid gap-5">
      <h2 id="resend-confirmation-title" className="font-display text-xl">
        {title}
      </h2>
      <FormMessage form="resend-confirmation" state={state} />
      <TextField
        form="resend-confirmation"
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
          Send a new link
        </SubmitButton>
      </div>
    </form>
  );
}
