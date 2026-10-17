'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { FormMessage, SubmitButton, TextField, firstInvalid, useFocusOnError, useFormId } from '@/components/account/fields';
import { MAX_PASSWORD_LENGTH } from '@/lib/account-limits';
import { IDLE } from '@/lib/form-state';
import { signInAction } from './actions';

const FORM_NAME = 'sign-in';

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, IDLE);
  const FORM = useFormId(FORM_NAME);
  useFocusOnError(FORM, state);
  const first = firstInvalid(state, ['email', 'password']);
  return (
    <form id={FORM} action={action} noValidate className="grid gap-6">
      <input type="hidden" name="next" value={state.values?.next ?? next} />
      <FormMessage form={FORM} state={state} />
      <TextField
        form={FORM}
        name="email"
        type="email"
        label="E-mail address"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={254}
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
          maxLength={MAX_PASSWORD_LENGTH}
          state={state}
          autoFocus={first === 'password'}
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
