'use client';

import { useActionState, useState } from 'react';

import { FormMessage, SubmitButton, TextField, useFocusOnError } from '@/components/account/fields';
import { QrCode } from '@/components/account/qr-code';
import { MAX_PASSWORD_LENGTH, TOTP_DIGITS } from '@/lib/account-limits';
import { IDLE, type FormState } from '@/lib/form-state';
import type { TotpSetupView } from '@/server/auth/totp';
import { confirmTwoFactorAction, enableTwoFactorAction, verifySessionAction } from './actions';

type CodeAction = (previous: FormState, form: FormData) => Promise<FormState>;

/** A form that asks for the current TOTP code (or a backup code) and posts it to `action`. */
function CodeForm({
  id,
  action: serverAction,
  submitLabel,
  next,
  allowBackup,
}: {
  id: string;
  action: CodeAction;
  submitLabel: string;
  next?: string;
  allowBackup?: boolean;
}) {
  const [state, action, pending] = useActionState(serverAction, IDLE);
  const [method, setMethod] = useState<'totp' | 'backup'>('totp');
  useFocusOnError(id, state);
  const totp = method === 'totp';
  return (
    <form id={id} action={action} noValidate className="grid gap-5">
      <input type="hidden" name="method" value={method} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormMessage form={id} state={state} />
      <TextField
        key={method}
        form={id}
        name="code"
        label={totp ? '6-digit code' : 'Backup code'}
        autoComplete="one-time-code"
        inputMode={totp ? 'numeric' : 'text'}
        autoCapitalize="none"
        spellCheck={false}
        maxLength={totp ? TOTP_DIGITS + 2 : 32}
        hint={totp ? 'The code your authenticator app shows for WingChunRoots now.' : 'One of your saved backup codes. Each works once.'}
        state={state}
        autoFocus={state.status === 'error' && Boolean(state.fields?.code)}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SubmitButton pending={pending} pendingLabel="Checking…">
          {submitLabel}
        </SubmitButton>
        {allowBackup ? (
          <button
            type="button"
            onClick={() => setMethod(totp ? 'backup' : 'totp')}
            className="link inline-flex min-h-11 items-center text-ui"
          >
            {totp ? 'Use a backup code instead' : 'Use the authenticator app instead'}
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function VerifySessionForm({ next }: { next: string }) {
  return <CodeForm id="verify-session" action={verifySessionAction} submitLabel="Verify this session" next={next} allowBackup />;
}

function SetupSteps({ setup }: { setup: TotpSetupView }) {
  return (
    <ol className="grid gap-8">
      <li className="grid gap-3">
        <h3 className="font-display text-xl">1. Add WingChunRoots to your authenticator app</h3>
        <p className="max-w-[56ch] text-ui text-fg-muted">
          Scan the code with an app such as a password manager or an authenticator. On this phone,{' '}
          <a href={setup.uri} className="link">
            open it in your authenticator app
          </a>
          .
        </p>
        <QrCode qr={setup.qr} label="QR code of your two-factor secret for WingChunRoots" />
        <div className="grid gap-1">
          <p className="text-sm text-fg-muted" id="totp-secret-label">
            Cannot scan? Type this key instead (time-based, 6 digits):
          </p>
          <code
            aria-labelledby="totp-secret-label"
            translate="no"
            className="w-fit max-w-full rounded-sm border border-border-subtle bg-surface-2 px-3 py-2 font-mono text-base tracking-wider break-all select-all"
          >
            {setup.secret}
          </code>
        </div>
      </li>
      <li className="grid gap-3">
        <h3 className="font-display text-xl">2. Save your backup codes</h3>
        <p className="max-w-[56ch] text-ui text-fg-muted">
          If you lose your phone, each of these codes signs you in once. Keep them somewhere safe; they are shown only now.
        </p>
        <ul
          aria-label="Backup codes"
          translate="no"
          className="grid w-fit grid-cols-2 gap-x-6 gap-y-1 rounded-sm border border-border-subtle bg-surface-2 px-4 py-3 font-mono text-base select-all"
        >
          {setup.backupCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </li>
      <li className="grid gap-3">
        <h3 className="font-display text-xl">3. Enter the code from the app</h3>
        <CodeForm id="confirm-two-factor" action={confirmTwoFactorAction} submitLabel="Turn on two-factor authentication" />
      </li>
    </ol>
  );
}

export function TwoFactorSetup({ pending: setupPending }: { pending: boolean }) {
  const [state, action, pending] = useActionState(enableTwoFactorAction, IDLE);
  useFocusOnError('enable-two-factor', state);
  const setup = state.status === 'done' ? (state.data?.setup as TotpSetupView | undefined) : undefined;
  if (setup) return <SetupSteps setup={setup} />;
  return (
    <div className="grid gap-8">
      {setupPending ? (
        <div className="grid gap-4">
          <p className="max-w-[56ch] text-ui">
            You started the setup earlier. If WingChunRoots is already in your authenticator app, enter its code to finish.
          </p>
          <CodeForm id="confirm-two-factor" action={confirmTwoFactorAction} submitLabel="Turn on two-factor authentication" />
        </div>
      ) : null}
      <form id="enable-two-factor" action={action} noValidate className="grid gap-5">
        {setupPending ? <h3 className="font-display text-xl">Or start again</h3> : null}
        <FormMessage form="enable-two-factor" state={state} />
        <TextField
          form="enable-two-factor"
          name="password"
          type="password"
          label="Your password"
          autoComplete="current-password"
          maxLength={MAX_PASSWORD_LENGTH}
          hint="To protect the setup, confirm it is you."
          state={state}
          autoFocus={state.status === 'error' && Boolean(state.fields?.password)}
        />
        <div>
          <SubmitButton pending={pending} pendingLabel="Preparing…">
            {setupPending ? 'Start the setup again' : 'Set up two-factor authentication'}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
