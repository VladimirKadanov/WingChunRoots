'use client';

// The forms of /reset-password (milestone M02). Each renders the page's heading, so the heading
// always says what the page shows now: "Check your inbox" once a link is sent, "This link no
// longer works" (with a form for a new link) once a link is refused. `initial` is the outcome of a
// submit without JavaScript (src/server/forms/flash.ts).

import Link from 'next/link';
import { type ReactNode, useActionState } from 'react';

import { FrameBody, FrameHeader, type FrameHeading } from '@/components/account/auth-frame';
import {
  DoneText,
  FormMessage,
  SubmitButton,
  TextField,
  doneId,
  messageId,
  useFocusOnError,
  useFormId,
} from '@/components/account/fields';
import { EMAIL_MAX_LENGTH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/account-limits';
import { IDLE, isRefusedLink, type FormState } from '@/lib/form-state';
import { requestResetAction, resetPasswordAction } from './actions';
import { linkRefused } from './headings';

export function RequestResetForm({
  heading,
  headingId,
  initial,
  footer,
}: {
  heading: FrameHeading;
  /** Set when the heading is itself an outcome (a refused link): it then takes the focus. */
  headingId?: string;
  initial?: FormState | null;
  footer?: ReactNode;
}) {
  const [state, action, pending] = useActionState(requestResetAction, initial ?? IDLE);
  const form = useFormId('request-reset');
  useFocusOnError(form, state);
  if (state.status === 'done') {
    return (
      <>
        <FrameHeader eyebrow={heading.eyebrow} title="Check your inbox" id={doneId(form)} focus />
        <FrameBody>
          <DoneText>
            <p>
              We sent an e-mail to{' '}
              <strong className="font-semibold break-all text-fg" translate="no">
                {state.values?.email}
              </strong>
              , if it belongs to an account. Its link lets you choose a new password once, within one hour.
            </p>
            <p>
              Asked more than once? Any of the links works until it expires. At most three e-mails go out in an hour.
            </p>
            <p>
              Remembered it? <Link href="/sign-in" className="link">Sign in</Link>.
            </p>
          </DoneText>
        </FrameBody>
      </>
    );
  }
  return (
    <>
      <FrameHeader {...heading} id={headingId} focus={Boolean(headingId) && state.status === 'idle'} />
      <FrameBody>
        <form id={form} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6">
          <FormMessage form={form} state={state} single />
          <TextField
            form={form}
            name="email"
            type="email"
            label="E-mail address"
            autoComplete="email"
            inputMode="email"
            enterKeyHint="send"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={EMAIL_MAX_LENGTH}
            state={state}
            autoFocus={state.status === 'error' && Boolean(state.fields?.email)}
          />
          <div>
            <SubmitButton pending={pending} pendingLabel="Sending…">
              {headingId ? 'Send a new link' : 'Send the reset link'}
            </SubmitButton>
          </div>
        </form>
        {footer}
      </FrameBody>
    </>
  );
}

export function NewPasswordForm({
  token,
  finish,
  heading,
  initial,
}: {
  token: string;
  /** The link of a sign-up that finishes by choosing the password (src/server/auth/accounts.ts). */
  finish: boolean;
  heading: FrameHeading;
  initial?: FormState | null;
}) {
  const [state, action, pending] = useActionState(resetPasswordAction, initial ?? IDLE);
  const form = useFormId('new-password');
  useFocusOnError(form, state);
  // The link has expired or was used: ask for a new one in place.
  if (isRefusedLink(state)) return <RequestResetForm heading={linkRefused(state)} headingId={messageId(form)} />;
  return (
    <>
      <FrameHeader {...heading} />
      <FrameBody>
        <form id={form} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6">
          <input type="hidden" name="token" value={token} />
          {finish ? <input type="hidden" name="finish" value="1" /> : null}
          <FormMessage form={form} state={state} single />
          <TextField
            form={form}
            name="password"
            type="password"
            label={finish ? 'Password' : 'New password'}
            autoComplete="new-password"
            enterKeyHint="done"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters. A password manager or a long phrase works best; pasting is fine.`}
            state={state}
            autoFocus={state.status === 'error' && Boolean(state.fields?.password)}
          />
          <div>
            <SubmitButton pending={pending} pendingLabel="Saving…">
              {finish ? 'Save the password' : 'Save the new password'}
            </SubmitButton>
          </div>
        </form>
      </FrameBody>
    </>
  );
}
