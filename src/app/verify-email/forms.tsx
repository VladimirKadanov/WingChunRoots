'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { DoneNotice, FormMessage, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { IDLE } from '@/lib/form-state';
import { confirmEmailAction, resendConfirmationAction } from './actions';

export function ConfirmEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmEmailAction, IDLE);
  const form = useFormId('confirm-email');
  useFocusOnError(form, state);
  return (
    <form id={form} action={action} className="grid gap-6">
      <input type="hidden" name="token" value={token} />
      <FormMessage form={form} state={state} />
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

/** `secondary` when the page's primary action is another form (the confirm button). */
export function ResendConfirmationForm({ title = 'Send the link again', secondary = false }: { title?: string; secondary?: boolean }) {
  const [state, action, pending] = useActionState(resendConfirmationAction, IDLE);
  const form = useFormId('resend-confirmation');
  useFocusOnError(form, state);
  if (state.status === 'done') {
    return (
      <DoneNotice form={form} title="Check your inbox">
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
    <form id={form} action={action} noValidate aria-labelledby={`${form}-title`} className="grid gap-5">
      <h2 id={`${form}-title`} className="font-display text-xl">
        {title}
      </h2>
      <FormMessage form={form} state={state} />
      <TextField
        form={form}
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
        <SubmitButton pending={pending} pendingLabel="Sending…" variant={secondary ? 'secondary' : 'primary'}>
          Send a new link
        </SubmitButton>
      </div>
    </form>
  );
}
