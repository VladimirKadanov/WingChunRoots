'use client';

// The forms of /account/security (milestone M02): the code of the authenticator app (finishing the
// setup, verifying a session) and the forms that take the password (set up, new backup codes, turn
// off). `initial` is the outcome of a submit without JavaScript (src/server/forms/flash.ts).

import { useActionState, useState } from 'react';

import { CheckboxField, CodeField, FormMessage, SubmitButton, TextField, useFocusOnError, useFormId } from '@/components/account/fields';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/account-limits';
import { IDLE, type FormState } from '@/lib/form-state';
import {
  changeEmailAction,
  changePasswordAction,
  confirmTwoFactorAction,
  disableTwoFactorAction,
  enableTwoFactorAction,
  newBackupCodesAction,
  signOutOtherDevicesAction,
  verifySessionAction,
} from './actions';

type Action = (previous: FormState, form: FormData) => Promise<FormState>;

/** A form that asks for the current TOTP code (or a backup code) and posts it to `action`. */
function CodeForm({
  id,
  action: serverAction,
  submitLabel,
  next,
  allowBackup,
  initial,
}: {
  id: string;
  action: Action;
  submitLabel: string;
  next?: string;
  allowBackup?: boolean;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(serverAction, initial ?? IDLE);
  const [method, setMethod] = useState<'totp' | 'backup'>(state.values?.method === 'backup' ? 'backup' : 'totp');
  const formId = useFormId(id);
  useFocusOnError(formId, state);
  const totp = method === 'totp';
  return (
    <form id={formId} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5">
      <input type="hidden" name="method" value={method} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormMessage form={formId} state={state} single />
      <CodeField
        key={method}
        form={formId}
        kind={method}
        hint={totp ? 'The code your authenticator app shows for WingChunRoots now.' : 'One of your saved backup codes. Each works once.'}
        state={state}
        autoFocus={state.status === 'error' && Boolean(state.fields?.code)}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SubmitButton pending={pending} pendingLabel="Checking…">
          {submitLabel}
        </SubmitButton>
        {allowBackup ? (
          <button type="button" onClick={() => setMethod(totp ? 'backup' : 'totp')} className="link inline-flex min-h-11 items-center text-ui">
            {totp ? 'Use a backup code instead' : 'Use the authenticator app instead'}
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function VerifySessionForm({ next, initial }: { next: string; initial?: FormState | null }) {
  return <CodeForm id="verify-session" action={verifySessionAction} submitLabel="Verify this session" next={next} allowBackup initial={initial} />;
}

export function ConfirmTwoFactorForm({ initial }: { initial?: FormState | null }) {
  return <CodeForm id="confirm-two-factor" action={confirmTwoFactorAction} submitLabel="Turn on two-factor authentication" initial={initial} />;
}

/** A form of one password field and one button. */
function PasswordForm({
  id,
  action: serverAction,
  submitLabel,
  pendingLabel,
  hint,
  variant,
  initial,
}: {
  id: string;
  action: Action;
  submitLabel: string;
  pendingLabel: string;
  hint: string;
  variant: 'primary' | 'secondary';
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(serverAction, initial ?? IDLE);
  const form = useFormId(id);
  useFocusOnError(form, state);
  return (
    <form id={form} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5">
      <FormMessage form={form} state={state} single />
      <TextField
        form={form}
        name="password"
        type="password"
        label="Your password"
        autoComplete="current-password"
        enterKeyHint="go"
        maxLength={MAX_PASSWORD_LENGTH}
        hint={hint}
        state={state}
        autoFocus={state.status === 'error' && Boolean(state.fields?.password)}
      />
      <div>
        <SubmitButton pending={pending} pendingLabel={pendingLabel} variant={variant}>
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Sets up two-factor authentication with the password. `again`: a second action under a pending
 * setup (secondary); `restart`: the page's main action when the pending key cannot be shown here.
 */
export function EnableTwoFactorForm({
  again = false,
  restart = false,
  initial,
}: {
  again?: boolean;
  restart?: boolean;
  initial?: FormState | null;
}) {
  const anew = again || restart;
  return (
    <PasswordForm
      id="enable-two-factor"
      action={enableTwoFactorAction}
      submitLabel={anew ? 'Start again with a new key' : 'Set up two-factor authentication'}
      pendingLabel="Preparing…"
      hint={anew ? 'A key you already added to your app stops working; you add the new one instead.' : 'To protect the setup, confirm it is you.'}
      variant={again ? 'secondary' : 'primary'}
      initial={initial}
    />
  );
}

export function NewBackupCodesForm({ initial }: { initial?: FormState | null }) {
  return (
    <PasswordForm
      id="new-backup-codes"
      action={newBackupCodesAction}
      submitLabel="Get new backup codes"
      pendingLabel="Making new codes…"
      hint="Your current backup codes stop working; you save the new ones instead."
      variant="secondary"
      initial={initial}
    />
  );
}

export function DisableTwoFactorForm({ initial }: { initial?: FormState | null }) {
  return (
    <PasswordForm
      id="disable-two-factor"
      action={disableTwoFactorAction}
      submitLabel="Turn off two-factor authentication"
      pendingLabel="Turning off…"
      hint="Signing in then needs only your password. You can turn it on again at any time."
      variant="secondary"
      initial={initial}
    />
  );
}

// Journey review P2-4 (ADR 0081): the password, the e-mail address and the other sessions.

export function ChangePasswordForm({ initial }: { initial?: FormState | null }) {
  const [state, action, pending] = useActionState(changePasswordAction, initial ?? IDLE);
  const form = useFormId('change-password');
  useFocusOnError(form, state);
  return (
    <form id={form} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5">
      <FormMessage form={form} state={state} />
      <TextField
        form={form}
        name="password"
        type="password"
        label="Current password"
        autoComplete="current-password"
        maxLength={MAX_PASSWORD_LENGTH}
        state={state}
        autoFocus={state.status === 'error' && Boolean(state.fields?.password)}
      />
      <TextField
        form={form}
        name="newPassword"
        type="password"
        label="New password"
        autoComplete="new-password"
        enterKeyHint="done"
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A password manager or a long phrase works best; pasting is fine.`}
        state={state}
      />
      <CheckboxField form={form} name="signOutOthers" label="Sign out of my other devices" defaultChecked state={state} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Saving…" variant="secondary">
          Change password
        </SubmitButton>
      </div>
    </form>
  );
}

export function ChangeEmailForm({ initial }: { initial?: FormState | null }) {
  const [state, action, pending] = useActionState(changeEmailAction, initial ?? IDLE);
  const form = useFormId('change-email');
  useFocusOnError(form, state);
  if (state.status === 'done') {
    return (
      <p role="status" className="max-w-[56ch] text-ui" data-testid="change-email-sent">
        Check the inbox of <span translate="no" className="font-semibold [overflow-wrap:anywhere]">{state.values?.email}</span>. The link there
        makes it your sign-in address; until you use it, nothing changes. We also tell your current address once the change is made.
      </p>
    );
  }
  return (
    <form id={form} action={action} noValidate aria-busy={pending || undefined} className="grid gap-5">
      <FormMessage form={form} state={state} />
      <TextField
        form={form}
        name="email"
        type="email"
        label="New e-mail address"
        autoComplete="email"
        inputMode="email"
        maxLength={254}
        hint="We send a link there; the address changes when you use it."
        state={state}
        autoFocus={state.status === 'error' && Boolean(state.fields?.email)}
      />
      <TextField
        form={form}
        name="password"
        type="password"
        label="Your password"
        autoComplete="current-password"
        enterKeyHint="go"
        maxLength={MAX_PASSWORD_LENGTH}
        state={state}
      />
      <div>
        <SubmitButton pending={pending} pendingLabel="Sending…" variant="secondary">
          Send the confirmation link
        </SubmitButton>
      </div>
    </form>
  );
}

export function SignOutOtherDevicesForm({ initial }: { initial?: FormState | null }) {
  const [state, action, pending] = useActionState(signOutOtherDevicesAction, initial ?? IDLE);
  const form = useFormId('sign-out-others');
  return (
    <form id={form} action={action} aria-busy={pending || undefined} className="grid gap-4">
      <FormMessage form={form} state={state} single />
      <p className="max-w-[56ch] text-ui text-fg-muted">Every other browser and phone signed in to your account signs out; this one stays signed in.</p>
      <div>
        <SubmitButton pending={pending} pendingLabel="Signing out…" variant="secondary">
          Sign out of other devices
        </SubmitButton>
      </div>
    </form>
  );
}
