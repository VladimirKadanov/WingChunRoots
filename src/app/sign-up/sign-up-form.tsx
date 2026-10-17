'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { CONSENT_LABELS, CONSENT_ORDER } from '@/components/account/consents';
import { CheckboxField, DoneNotice, FormMessage, SubmitButton, TextField, firstInvalid, useFocusOnError, useFormId } from '@/components/account/fields';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/account-limits';
import { IDLE } from '@/lib/form-state';
import { signUpAction } from './actions';

const FORM_NAME = 'sign-up';

export function SignUpForm({ required }: { required: readonly string[] }) {
  const [state, action, pending] = useActionState(signUpAction, IDLE);
  const FORM = useFormId(FORM_NAME);
  useFocusOnError(FORM, state);

  if (state.status === 'done') {
    return (
      <DoneNotice form={FORM} title="Check your inbox">
        <p>
          If <strong className="font-semibold text-fg">{state.values?.email}</strong> can be used for a new account, we have sent it a link to
          confirm the address. The link works for 24 hours; after that, ask for a new one.
        </p>
        <p>
          Nothing arrived, or you already have an account? <Link href="/verify-email" className="link">Send the link again</Link>,{' '}
          <Link href="/sign-in" className="link">sign in</Link> or <Link href="/reset-password" className="link">reset your password</Link>.
        </p>
      </DoneNotice>
    );
  }

  const first = firstInvalid(state, ['email', 'password', ...CONSENT_ORDER]);
  return (
    <form id={FORM} action={action} noValidate className="grid gap-6">
      <FormMessage form={FORM} state={state} />
      <TextField
        form={FORM}
        name="email"
        type="email"
        label="E-mail address"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={254}
        state={state}
        autoFocus={first === 'email'}
      />
      <TextField
        form={FORM}
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A password manager or a long phrase works best; pasting is fine.`}
        state={state}
        autoFocus={first === 'password'}
      />
      <fieldset className="grid gap-1">
        <legend className="mb-1 font-display text-xl">Before you join</legend>
        <p className="mb-2 text-sm text-fg-muted">
          Read the <Link href="/legal/terms" className="link">terms of use</Link> and the{' '}
          <Link href="/legal/privacy" className="link">privacy notice</Link>. Both are drafts pending legal review. We never ask for
          your birth date.
        </p>
        {CONSENT_ORDER.map((name) => (
          <CheckboxField
            key={name}
            form={FORM}
            name={name}
            label={
              <>
                {CONSENT_LABELS[name]}
                {required.includes(name) ? null : <span className="text-fg-muted"> (optional)</span>}
              </>
            }
            required={required.includes(name)}
            state={state}
            autoFocus={first === name}
          />
        ))}
      </fieldset>
      <div>
        <SubmitButton pending={pending} pendingLabel="Creating your account…">
          Create account
        </SubmitButton>
      </div>
    </form>
  );
}
