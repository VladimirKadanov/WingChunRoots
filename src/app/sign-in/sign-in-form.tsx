'use client';

// The sign-in form (milestone M02). `email` is the address an account has just confirmed
// (src/server/forms/flash.ts, rememberSignInEmail), so the form starts at the password; `initial`
// is the outcome of a submit without JavaScript.

import Link from 'next/link';
import { useActionState } from 'react';

import { FormMessage, SubmitButton, TextField, firstInvalid, useFocusOnError, useFormId } from '@/components/account/fields';
import { EMAIL_MAX_LENGTH, MAX_PASSWORD_LENGTH } from '@/lib/account-limits';
import { IDLE, type FormState } from '@/lib/form-state';
import { signInAction } from './actions';

const FORM_NAME = 'sign-in';
const LABELS = { email: 'E-mail address', password: 'Password' };

export function SignInForm({ next, email, initial }: { next: string; email?: string | null; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(signInAction, initial ?? IDLE);
  const FORM = useFormId(FORM_NAME);
  useFocusOnError(FORM, state);
  const first = firstInvalid(state, ['email', 'password']);
  const knownEmail = state.status === 'idle' && Boolean(email);
  return (
    <form id={FORM} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6">
      <input type="hidden" name="next" value={state.values?.next ?? next} />
      <FormMessage form={FORM} state={state} labels={LABELS} />
      <TextField
        form={FORM}
        name="email"
        type="email"
        label="E-mail address"
        autoComplete="username"
        inputMode="email"
        enterKeyHint="next"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={EMAIL_MAX_LENGTH}
        defaultValue={email ?? undefined}
        state={state}
        autoFocus={first === 'email'}
      />
      <div className="grid gap-1">
        <TextField
          form={FORM}
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          enterKeyHint="go"
          maxLength={MAX_PASSWORD_LENGTH}
          state={state}
          autoFocus={first === 'password' || knownEmail}
        />
        <p className="text-sm">
          <Link href="/reset-password" className="link inline-flex min-h-11 items-center">
            Forgot your password?
          </Link>
        </p>
      </div>
      <div>
        <SubmitButton pending={pending} pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </div>
    </form>
  );
}
