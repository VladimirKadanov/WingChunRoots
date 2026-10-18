'use client';

// The forms of /verify-email (milestone M02). Each renders the page's heading, so the heading
// always says what the page shows now: the link's one button, "This link no longer works" (with a
// form for a new link) once the link is refused, and "Check your inbox" once a new link is sent.
// `initial` is the outcome of a submit without JavaScript (src/server/forms/flash.ts).

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
import { EMAIL_MAX_LENGTH } from '@/lib/account-limits';
import { IDLE, isRefusedLink, type FormState } from '@/lib/form-state';
import { confirmEmailAction, resendConfirmationAction } from './actions';
import { CONFIRM, linkRefused } from './headings';

export function ConfirmEmailForm({ token, initial }: { token: string; initial?: FormState | null }) {
  const [state, action, pending] = useActionState(confirmEmailAction, initial ?? IDLE);
  const form = useFormId('confirm-email');
  useFocusOnError(form, state);
  if (isRefusedLink(state)) return <ResendConfirmationForm heading={linkRefused(state)} headingId={messageId(form)} />;
  return (
    <>
      <FrameHeader {...CONFIRM} />
      <FrameBody>
        <form id={form} action={action} aria-busy={pending || undefined} className="grid gap-6">
          <input type="hidden" name="token" value={token} />
          <FormMessage form={form} state={state} />
          <div>
            <SubmitButton pending={pending} pendingLabel="Confirming…">
              Confirm my address
            </SubmitButton>
          </div>
        </form>
      </FrameBody>
    </>
  );
}

export function ResendConfirmationForm({
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
  const [state, action, pending] = useActionState(resendConfirmationAction, initial ?? IDLE);
  const form = useFormId('resend-confirmation');
  useFocusOnError(form, state);
  if (state.status === 'done') {
    return (
      <>
        <FrameHeader eyebrow={heading.eyebrow} title="Check your inbox" id={doneId(form)} focus />
        <FrameBody>
          <DoneText>
            <p>
              We sent a new link to{' '}
              <strong className="font-semibold text-fg [overflow-wrap:anywhere]" translate="no">
                {state.values?.email}
              </strong>
              , if it belongs to an account that waits for confirmation. It works for 24 hours.
            </p>
            <p>
              Already confirmed? <Link href="/sign-in" className="link">Sign in</Link>.
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
              Send a new link
            </SubmitButton>
          </div>
        </form>
        {footer}
      </FrameBody>
    </>
  );
}
