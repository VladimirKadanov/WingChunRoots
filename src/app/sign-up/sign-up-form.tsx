'use client';

// The sign-up form (milestone M02). It renders the page's heading too: once the account is made,
// "Check your inbox" replaces "Create your account" and takes the focus. `initial` is the outcome
// of a submit without JavaScript (src/server/forms/flash.ts).

import Link from 'next/link';
import { type ReactNode, useActionState } from 'react';

import { FrameBody, FrameHeader } from '@/components/account/auth-frame';
import { CONSENT_LABELS, CONSENT_ORDER } from '@/components/account/consents';
import {
  CheckboxField,
  DoneText,
  FormMessage,
  SubmitButton,
  TextField,
  doneId,
  firstInvalid,
  useFocusOnError,
  useFormId,
} from '@/components/account/fields';
import { EMAIL_MAX_LENGTH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@/lib/account-limits';
import { IDLE, type FormState } from '@/lib/form-state';
import { signUpAction } from './actions';

const FORM_NAME = 'sign-up';
const EYEBROW = 'Join the pilot';

export interface SignUpDocument {
  title: string;
  path: string;
  date: string;
}

/** The names of the fields in the error summary, in the order of the form. */
const LABELS: Record<string, string> = {
  email: 'E-mail address',
  password: 'Password',
  age_18_plus: 'Age',
  terms: 'Terms of use',
  authenticity_declaration: 'What you record',
  privacy_ack: 'Privacy notice',
};

export function SignUpForm({
  required,
  terms,
  privacy,
  initial,
  footer,
}: {
  required: readonly string[];
  terms: SignUpDocument;
  privacy: SignUpDocument;
  initial?: FormState | null;
  footer: ReactNode;
}) {
  const [state, action, pending] = useActionState(signUpAction, initial ?? IDLE);
  const FORM = useFormId(FORM_NAME);
  useFocusOnError(FORM, state);

  if (state.status === 'done') {
    return (
      <>
        <FrameHeader eyebrow={EYEBROW} title="Check your inbox" id={doneId(FORM)} focus />
        <FrameBody>
          <DoneText>
            <p>
              We sent an e-mail to{' '}
              <strong className="font-semibold text-fg [overflow-wrap:anywhere]" translate="no">
                {state.values?.email}
              </strong>
              . Open its link within 24 hours to confirm the address, then sign in. If the address already has an account, the e-mail says
              how to get into it instead.
            </p>
            <p>
              Nothing arrived after a few minutes? Look in the spam folder, or{' '}
              <Link href="/verify-email" className="link">
                send the link again
              </Link>
              . Already have an account? <Link href="/sign-in" className="link">Sign in</Link> or{' '}
              <Link href="/reset-password" className="link">
                reset your password
              </Link>
              .
            </p>
          </DoneText>
        </FrameBody>
      </>
    );
  }

  const first = firstInvalid(state, ['email', 'password', ...CONSENT_ORDER]);
  return (
    <>
      <FrameHeader
        eyebrow={EYEBROW}
        title="Create your account"
        lede="An account lets you record who taught you and whom you teach. Every link is confirmed by the other person or by evidence before it is shown as fact."
      />
      <FrameBody>
        <form id={FORM} action={action} noValidate aria-busy={pending || undefined} className="grid gap-6">
          <FormMessage form={FORM} state={state} labels={LABELS} />
          <TextField
            form={FORM}
            name="email"
            type="email"
            label="E-mail address"
            autoComplete="email"
            inputMode="email"
            enterKeyHint="next"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={EMAIL_MAX_LENGTH}
            state={state}
            autoFocus={first === 'email'}
          />
          <TextField
            form={FORM}
            name="password"
            type="password"
            label="Password"
            autoComplete="new-password"
            enterKeyHint="next"
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters. A password manager or a long phrase works best; pasting is fine.`}
            state={state}
            autoFocus={first === 'password'}
          />
          <fieldset className="grid gap-1">
            <legend className="mb-1 font-display text-xl">Before you join</legend>
            <div className="mb-2 grid gap-1 text-sm text-fg-muted">
              <p>Read these first. Both are drafts that wait for a legal review. We never ask for your birth date.</p>
              {/* Each link on its own line: inside a sentence the padded links of two lines overlapped
                  and each kept a 30 px target on a touch screen (fix round 3, screens-9). */}
              <ul className="grid gap-1">
                {[terms, privacy].map((document) => (
                  <li key={document.path}>
                    <Link href={document.path} className="link inline-flex items-center pointer-coarse:min-h-11">
                      {document.title}
                    </Link>
                    , draft of {document.date}
                  </li>
                ))}
              </ul>
            </div>
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
                hint={required.includes(name) ? undefined : 'You can join without this tick. The privacy notice applies either way; the tick records that you read this version.'}
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
        {footer}
      </FrameBody>
    </>
  );
}
